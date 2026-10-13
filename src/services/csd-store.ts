import "server-only";
import { createPrivateKey, randomUUID, X509Certificate } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import type { Custody } from "@/lib/csd/custody";
import { CsdError } from "@/lib/csd/errors";
import {
  EnvelopeError,
  openPrivateKey,
  sealPrivateKey,
  type EnvelopeContext,
  type SealedPrivateKey,
} from "@/lib/csd/envelope";
import { csdCustodyTerms } from "@/lib/csd/custody-terms";
import { keyProviderFor } from "@/lib/csd/key-provider";
import { validateCsdUpload, type CsdUpload } from "@/lib/csd/validate";
import type {
  ConfigureCsdResponse,
  CsdHistoryItem,
  CsdInvalidReason,
  CsdState,
} from "@/types/csd";
import type { PacEnvironment } from "@/types/stamping";
import { certificateBindingFromDer } from "@/lib/cfdi40/certificate-binding";
import { Cfdi40Error, cfdi40Issue } from "@/lib/cfdi40/errors";
import type { Cfdi40CertificateBinding } from "@/lib/cfdi40/types";

// Fase 5C.3: CSD custody of one Organization, without session access so it can be tested
// against PGlite. `actor` must come from a server-validated tenant (services/csd.ts);
// every query is scoped to actor.organizationId and never to a client-supplied id.
// Metadata queries never select the private-key envelope.

type Db = PrismaClient;
type Env = Record<string, string | undefined>;
export type CsdActor = { organizationId: string; userId: string; role: string };
export type ConfigureCsdInput = CsdUpload & {
  replace: boolean;
  expectedActiveCsdId: string | null;
};

export const canManageCsd = (role: string) =>
  role === "OWNER" || role === "ADMIN";

const expiringSoonMs = 30 * 24 * 3600 * 1000;
const transactionOptions = { maxWait: 10_000, timeout: 20_000 };

const activeSelect = {
  id: true,
  environment: true,
  certificateNumber: true,
  rfc: true,
  validFrom: true,
  validTo: true,
  updatedAt: true,
} as const;

/** Confirmed Fiscal Profile RFC of the Organization, normalized; null when missing. */
async function confirmedProfileRfc(
  db: Pick<Db, "fiscalProfile">,
  organizationId: string,
) {
  const profile = await db.fiscalProfile.findFirst({
    where: { organizationId, confirmedAt: { not: null } },
    select: { rfc: true },
  });
  const rfc = profile?.rfc.trim().toUpperCase();
  return rfc || null;
}

/** §C.2: effective state, recomputed on every read; only VALID can sign. */
export async function readCsdState(
  db: Db,
  actor: CsdActor,
  custody: Custody,
  now = new Date(),
  env: Env = process.env,
): Promise<CsdState> {
  const { organizationId } = actor;
  const [active, profileRfc] = await Promise.all([
    db.csdCertificate.findFirst({
      where: { organizationId, status: "ACTIVE" },
      select: activeSelect,
    }),
    confirmedProfileRfc(db, organizationId),
  ]);
  const base = {
    canManage: canManageCsd(actor.role),
    serviceAvailable: custody.available,
  };
  if (!active)
    return {
      ...base,
      status: "NOT_CONFIGURED",
      id: null,
      environment: null,
      invalidReason: null,
      expiresSoon: false,
      certificateNumber: null,
      rfc: null,
      validFrom: null,
      validTo: null,
      updatedAt: null,
      verification: null,
    };
  const keyRef = await db.csdPrivateKey.findFirst({
    where: { organizationId, csdCertificateId: active.id },
    select: { kekProvider: true, kekId: true, kekVersion: true },
  });
  // A CSD only serves its own fiscal environment, with the provider configured for it.
  const provider = keyProviderFor(active.environment, env);
  const keyAvailable =
    !!keyRef &&
    active.environment === custody.environment &&
    keyRef.kekProvider === provider.provider &&
    provider.canUnwrap({
      provider: keyRef.kekProvider,
      keyId: keyRef.kekId,
      keyVersion: keyRef.kekVersion,
    });
  const time = now.getTime();
  const withinValidity =
    active.validFrom.getTime() <= time && time < active.validTo.getTime();
  const rfcMatchesIssuer = profileRfc === active.rfc;
  let invalidReason: CsdInvalidReason | null = null;
  let status: CsdState["status"] = "VALID";
  if (time < active.validFrom.getTime()) {
    status = "INVALID";
    invalidReason = "NOT_YET_VALID";
  } else if (time >= active.validTo.getTime()) status = "EXPIRED";
  else if (!rfcMatchesIssuer) {
    status = "INVALID";
    invalidReason = "RFC_CHANGED";
  } else if (!keyAvailable) {
    status = "INVALID";
    invalidReason = "KEY_UNAVAILABLE";
  }
  const remaining = active.validTo.getTime() - time;
  return {
    ...base,
    status,
    id: active.id,
    environment: active.environment,
    invalidReason,
    expiresSoon: remaining > 0 && remaining <= expiringSoonMs,
    certificateNumber: active.certificateNumber,
    rfc: active.rfc,
    validFrom: active.validFrom.toISOString(),
    validTo: active.validTo.toISOString(),
    updatedAt: active.updatedAt.toISOString(),
    verification: {
      // Proven when the CSD was configured; a mismatching key is never stored.
      keyMatchesCertificate: true,
      rfcMatchesIssuer,
      withinValidity,
      csdTypeVerifiedLocally: false,
    },
  };
}

/** Best-effort FAILURE/DENIED evidence, outside the failed work (§Q). */
export async function recordCsdConfigurationFailure(
  db: Pick<Db, "auditEvent">,
  actor: CsdActor,
  error: CsdError,
) {
  try {
    await recordAuditEvent(db, {
      action: "csd.configuration.failed",
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      result: "FAILURE",
      metadata: { errorCode: error.csdCode, stage: error.stage ?? undefined },
    });
  } catch {
    // The original error is what the caller reports; audit storage failures are not.
  }
}

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "P2002";

/**
 * §K/§M/§U: validates the material, then, under the Organization row lock, either returns
 * the idempotent result (same certificate), rejects (ALREADY_ACTIVE/CONFLICT) or creates
 * the new ACTIVE CSD with its envelope. On replacement the previous CSD becomes REPLACED
 * and its CsdPrivateKey is deleted in the same transaction: any failure rolls back all.
 */
export async function configureCsd(
  db: Db,
  actor: CsdActor,
  input: ConfigureCsdInput,
  custody: Custody,
  now = new Date(),
  env: Env = process.env,
): Promise<ConfigureCsdResponse> {
  const { organizationId, userId } = actor;
  let pkcs8: Buffer | null = null;
  try {
    // 1. Role and custody for the current fiscal environment (the session wrapper has
    // already checked the recent sign-in and rate limits).
    if (!canManageCsd(actor.role)) throw new CsdError("CSD_FORBIDDEN", 1);
    if (!custody.available || !custody.environment || !custody.provider)
      throw new CsdError("CSD_SERVICE_UNAVAILABLE", 1);
    const environment: PacEnvironment = custody.environment;
    const provider = custody.provider;
    // 2. Confirmed Fiscal Profile with RFC.
    const profileRfc = await confirmedProfileRfc(db, organizationId);
    if (!profileRfc) throw new CsdError("CSD_ISSUER_PROFILE_REQUIRED", 2);
    // 3–12, and the in-memory normalization of 13.
    const validated = validateCsdUpload(input, {
      profileRfc,
      environment,
      authorities: custody.authorities,
      now,
    });
    const sealedKey = validated.pkcs8;
    pkcs8 = sealedKey;
    const certificate = validated.certificate;
    const csdCertificateId = randomUUID();
    let created = false;
    try {
      created = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
        const active = await tx.csdCertificate.findFirst({
          where: { organizationId, status: "ACTIVE" },
          select: { id: true, certificateSha256: true },
        });
        const configured = {
          certificateNumber: certificate.certificateNumber,
          environment,
          validTo: certificate.validTo.toISOString(),
        };
        // §U: same certificate as the active one, with a password that opens a matching
        // key ⇒ idempotent, without re-encrypting or creating rows.
        if (active && active.certificateSha256 === certificate.sha256) {
          await recordAuditEvent(tx, {
            action: "csd.configured",
            organizationId,
            actorUserId: userId,
            targetId: active.id,
            metadata: { ...configured, created: false },
          });
          return false;
        }
        if (active && !input.replace) throw new CsdError("CSD_ALREADY_ACTIVE");
        if (input.replace && active?.id !== input.expectedActiveCsdId)
          throw new CsdError("CSD_CONFLICT");
        // CSD_IN_USE needs signing attempts (CFDI phase); none exist in this phase.
        // 13. Encrypt and verify the round trip before anything is written.
        const context: EnvelopeContext = {
          organizationId,
          csdCertificateId,
          certificateSha256: certificate.sha256,
          environment,
        };
        let sealed: SealedPrivateKey;
        try {
          sealed = await sealPrivateKey(provider, context, sealedKey);
        } catch (error) {
          throw new CsdError(
            error instanceof EnvelopeError && error.reason === "KEY_UNAVAILABLE"
              ? "CSD_SERVICE_UNAVAILABLE"
              : "CSD_ENCRYPTION_FAILED",
            13,
          );
        }
        if (active) {
          const ended = await tx.csdCertificate.updateMany({
            where: { id: active.id, organizationId, status: "ACTIVE" },
            data: {
              status: "REPLACED",
              activeOrganizationId: null,
              endedAt: now,
              endedById: userId,
              replacedById: csdCertificateId,
            },
          });
          if (ended.count !== 1) throw new CsdError("CSD_CONFLICT");
          // Crypto-shredding: ciphertext, IV, tag and wrapped DEK of the previous key.
          await tx.csdPrivateKey.deleteMany({
            where: { organizationId, csdCertificateId: active.id },
          });
        }
        await tx.csdCertificate.create({
          data: {
            id: csdCertificateId,
            organizationId,
            status: "ACTIVE",
            activeOrganizationId: organizationId,
            environment,
            certificateDer: new Uint8Array(certificate.der),
            certificateSha256: certificate.sha256,
            serialNumberHex: certificate.serialNumberHex,
            certificateNumber: certificate.certificateNumber,
            rfc: certificate.rfc,
            publicKeyAlgorithm: certificate.publicKeyAlgorithm,
            publicKeyBits: certificate.publicKeyBits,
            signatureAlgorithm: certificate.signatureAlgorithm,
            validFrom: certificate.validFrom,
            validTo: certificate.validTo,
            csdTypeVerifiedLocally: false,
            custodyConsentVersion: csdCustodyTerms.version,
            configuredById: userId,
            configuredAt: now,
          },
          select: { id: true },
        });
        await tx.csdPrivateKey.create({
          data: {
            csdCertificateId,
            organizationId,
            envelopeVersion: sealed.envelopeVersion,
            algorithm: sealed.algorithm,
            ciphertext: new Uint8Array(sealed.ciphertext),
            iv: new Uint8Array(sealed.iv),
            authTag: new Uint8Array(sealed.authTag),
            wrappedDek: new Uint8Array(sealed.wrappedDek),
            kekProvider: sealed.kekProvider,
            kekId: sealed.kekId,
            kekVersion: sealed.kekVersion,
            aadVersion: sealed.aadVersion,
          },
          select: { csdCertificateId: true },
        });
        if (active)
          await recordAuditEvent(tx, {
            action: "csd.replaced",
            organizationId,
            actorUserId: userId,
            targetId: csdCertificateId,
            metadata: {
              previousCertificateId: active.id,
              certificateNumber: certificate.certificateNumber,
            },
          });
        await recordAuditEvent(tx, {
          action: "csd.configured",
          organizationId,
          actorUserId: userId,
          targetId: csdCertificateId,
          metadata: { ...configured, created: true },
        });
        return true;
      }, transactionOptions);
    } catch (error) {
      // activeOrganizationId @unique is the database authority if two requests race.
      if (isUniqueViolation(error)) throw new CsdError("CSD_CONFLICT");
      throw error;
    }
    return {
      ...(await readCsdState(db, actor, custody, now, env)),
      created,
    };
  } catch (error) {
    if (error instanceof CsdError)
      await recordCsdConfigurationFailure(db, actor, error);
    throw error;
  } finally {
    pkcs8?.fill(0);
  }
}

/**
 * §L: ACTIVE ⇒ DISABLED and deletion of its CsdPrivateKey in one transaction under the
 * Organization lock. Idempotent when nothing is active. An id that is not this
 * Organization's behaves as nonexistent.
 */
export async function disableCsd(
  db: Db,
  actor: CsdActor,
  request: { expectedActiveCsdId: string },
  custody: Custody,
  now = new Date(),
  env: Env = process.env,
): Promise<CsdState> {
  const { organizationId, userId } = actor;
  if (!canManageCsd(actor.role)) throw new CsdError("CSD_FORBIDDEN");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
    const active = await tx.csdCertificate.findFirst({
      where: { organizationId, status: "ACTIVE" },
      select: { id: true, certificateNumber: true },
    });
    if (!active) return;
    if (active.id !== request.expectedActiveCsdId) {
      const known = await tx.csdCertificate.findFirst({
        where: { organizationId, id: request.expectedActiveCsdId },
        select: { id: true },
      });
      throw new CsdError(known ? "CSD_CONFLICT" : "CSD_NOT_FOUND");
    }
    const ended = await tx.csdCertificate.updateMany({
      where: { id: active.id, organizationId, status: "ACTIVE" },
      data: {
        status: "DISABLED",
        activeOrganizationId: null,
        endedAt: now,
        endedById: userId,
      },
    });
    if (ended.count !== 1) throw new CsdError("CSD_CONFLICT");
    await tx.csdPrivateKey.deleteMany({
      where: { organizationId, csdCertificateId: active.id },
    });
    await recordAuditEvent(tx, {
      action: "csd.disabled",
      organizationId,
      actorUserId: userId,
      targetId: active.id,
      metadata: {
        certificateNumber: active.certificateNumber,
        reason: "USER_REQUEST",
      },
    });
  }, transactionOptions);
  return readCsdState(db, actor, custody, now, env);
}

/** §O: newest first, at most 50; the visible name of who configured it, never an email. */
export async function listCsdHistory(
  db: Pick<Db, "csdCertificate">,
  organizationId: string,
): Promise<CsdHistoryItem[]> {
  const rows = await db.csdCertificate.findMany({
    where: { organizationId },
    orderBy: [{ configuredAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      status: true,
      certificateNumber: true,
      rfc: true,
      environment: true,
      validFrom: true,
      validTo: true,
      configuredAt: true,
      endedAt: true,
      configuredBy: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    certificateNumber: row.certificateNumber,
    rfc: row.rfc,
    environment: row.environment,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo.toISOString(),
    configuredAt: row.configuredAt.toISOString(),
    configuredBy: row.configuredBy?.name ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  }));
}

/**
 * Integrity check of the active envelope (§C.2 INTEGRITY, §V): decrypts in memory with the
 * provider of the CSD's environment and checks the key against the stored certificate.
 * Nothing leaves this function but the verdict; buffers are overwritten. The CFDI phase
 * signs through the same path; this phase never signs.
 */
export async function verifyActiveCsdEnvelope(
  db: Db,
  organizationId: string,
  env: Env = process.env,
): Promise<"OK" | "NOT_CONFIGURED" | "KEY_UNAVAILABLE" | "INTEGRITY"> {
  const active = await db.csdCertificate.findFirst({
    where: { organizationId, status: "ACTIVE" },
    select: {
      id: true,
      environment: true,
      certificateSha256: true,
      certificateDer: true,
      privateKey: true,
    },
  });
  if (!active) return "NOT_CONFIGURED";
  if (!active.privateKey) return "KEY_UNAVAILABLE";
  let pkcs8: Buffer | null = null;
  try {
    pkcs8 = await openPrivateKey(
      keyProviderFor(active.environment, env),
      {
        organizationId,
        csdCertificateId: active.id,
        certificateSha256: active.certificateSha256,
        environment: active.environment,
      },
      active.privateKey,
    );
    const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    return new X509Certificate(active.certificateDer).checkPrivateKey(key)
      ? "OK"
      : "INTEGRITY";
  } catch (error) {
    return error instanceof EnvelopeError ? error.reason : "INTEGRITY";
  } finally {
    pkcs8?.fill(0);
  }
}

/**
 * Fase 5C.5: NoCertificado and Certificado for a CFDI, from the PUBLIC certificate of the
 * active CSD only. Requires the effective state VALID (in force, RFC of the confirmed Fiscal
 * Profile, the fiscal environment's custody able to serve the key) and that the stored
 * DER is the certificate the record describes. Selects no envelope column and never opens
 * the private key: signing is the next gate. Throws Cfdi40Error CSD_NOT_VALID or
 * CSD_CERTIFICATE_MISMATCH.
 */
export async function readActiveCsdCertificateBinding(
  db: Db,
  actor: CsdActor,
  custody: Custody,
  now = new Date(),
  env: Env = process.env,
): Promise<{
  csdCertificateId: string;
  environment: PacEnvironment;
  binding: Cfdi40CertificateBinding;
}> {
  const notValid = () =>
    new Cfdi40Error([
      cfdi40Issue("CSD_NOT_VALID", "Comprobante/@NoCertificado", "ORBIT"),
    ]);
  const state = await readCsdState(db, actor, custody, now, env);
  if (state.status !== "VALID" || !state.id) throw notValid();
  const row = await db.csdCertificate.findFirst({
    where: {
      organizationId: actor.organizationId,
      id: state.id,
      status: "ACTIVE",
    },
    select: {
      environment: true,
      certificateDer: true,
      certificateSha256: true,
      serialNumberHex: true,
      certificateNumber: true,
    },
  });
  if (!row || row.environment !== custody.environment) throw notValid();
  return {
    csdCertificateId: state.id,
    environment: row.environment,
    binding: certificateBindingFromDer(row.certificateDer, row, now),
  };
}
