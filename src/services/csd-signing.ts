import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { certificateRfc, parseCertificate } from "@/lib/csd/certificate";
import { certificateNumberFromSerial } from "@/lib/csd/certificate-number";
import { productionLegalGateSatisfied, type Custody } from "@/lib/csd/custody";
import type { openPrivateKey } from "@/lib/csd/envelope";
import { pendingProductionSigningGates } from "@/lib/csd/production-gates";
import {
  CsdSigningError,
  cfdiSealAlgorithm,
  signWithCustodiedKey,
  type CsdSigningFailure,
} from "@/lib/csd/signing";
import { isIssuedByTestAuthority } from "@/lib/csd/test-authorities";
import { certificateBindingProblems } from "@/lib/cfdi40/certificate-binding";
import {
  Cfdi40Error,
  cfdi40Issue,
  type Cfdi40IssueCode,
} from "@/lib/cfdi40/errors";
import {
  compileCfdi40Xslt,
  generateCfdi40OriginalString,
  isCfdi40OriginalString,
} from "@/lib/cfdi40/original-string";
import { createSealedCfdi40 } from "@/lib/cfdi40/sealed";
import { isPreSealCfdi40, preSealIssuerRfc } from "@/lib/cfdi40/serialize";
import { cfdi40XsltEngine } from "@/lib/cfdi40/xslt-engine";
import { loadCfdi40XsltBundle } from "@/lib/cfdi40/xslt-resources";
import type {
  Cfdi40OriginalString,
  PreSealCfdi40Xml,
  SealedCfdi40Xml,
} from "@/lib/cfdi40/types";
import type { PacEnvironment } from "@/types/stamping";
import { canManageCsd, readCsdState, type CsdActor } from "./csd-store";

// Fase 5C.6: CsdVault.sign (FASE5C3 §AA.8) and the seal of a CFDI 4.0 with the custodied CSD
// of the Organization. Without session access so it can be tested against PGlite: `actor`
// comes from a server-validated tenant and every query is scoped to actor.organizationId.
// Never receives the .key password (it is not needed: the key is custodied) and never
// returns, logs or audits key material, the cadena original, the XML or the Sello.
//
// Not wired to any route: the per-invoice authorization (FASE5C3 §AA.9) and the stamping
// attempt (§AA.10) come first. Future order: authorization → seal → XSD → PAC.

type Db = PrismaClient;
type Env = Record<string, string | undefined>;

export type SealOptions = {
  /** Server clock; evaluated under the lock and again right before opening the key. */
  clock?: () => Date;
  env?: Env;
  /** Test seam to observe that the decrypted PKCS#8 is wiped; production uses the default. */
  openKey?: typeof openPrivateKey;
};

export type Cfdi40SignRequest = {
  preSeal: PreSealCfdi40Xml;
  originalString: Cfdi40OriginalString;
};
/** The only output of signing: the Sello and non-sensitive metadata (FASE5C3 §AA.8). */
export type Cfdi40SealSignature = {
  readonly sello: string;
  readonly algorithm: string;
  readonly csdCertificateId: string;
  readonly environment: PacEnvironment;
  readonly noCertificado: string;
};

const transactionOptions = { maxWait: 10_000, timeout: 20_000 };
const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

const fail = (code: Cfdi40IssueCode, path = "Comprobante/@Sello") =>
  new Cfdi40Error([cfdi40Issue(code, path, "ORBIT")]);
const signingFailures: Record<CsdSigningFailure, Cfdi40IssueCode> = {
  KEY_UNAVAILABLE: "CSD_KEY_UNAVAILABLE",
  INTEGRITY: "CSD_KEY_INTEGRITY_FAILED",
  MISMATCH: "CSD_KEY_MISMATCH",
  SIGN_FAILED: "CFDI_SEAL_FAILED",
  VERIFY_FAILED: "CFDI_SEAL_VERIFICATION_FAILED",
};
/** Coded errors pass through; anything else (database, engine) becomes CFDI_SEAL_FAILED. */
const coded = (error: unknown) =>
  error instanceof Cfdi40Error ? error : fail("CFDI_SEAL_FAILED");

/**
 * Signs the cadena original of a pre-seal CFDI with the active CSD of the actor's
 * Organization. In one transaction, holding FOR SHARE on the active CsdCertificate row (a
 * replacement or disable updates that row, so it waits for this signature; a CSD replaced or
 * disabled before is no longer ACTIVE here), it re-checks everything BEFORE opening the key:
 * role; ORBIT-made pre-seal XML and cadena of that same XML; custody of the current fiscal
 * environment (PRODUCTION: never the env provider, never without the Legal gate); effective
 * state VALID; stored DER equal to its record and to the certificate written in the XML; RSA
 * end-entity certificate; RFC of the certificate = record = Emisor of the CFDI; test
 * certificate in SANDBOX (§M.0); envelope of this provider; validity at the instant of
 * signing. Then it opens the key, signs (RSA-SHA256 PKCS#1 v1.5), verifies with the
 * certificate and returns only the Sello. Throws Cfdi40Error with a stable code.
 */
export async function signCfdi40OriginalString(
  db: Db,
  actor: CsdActor,
  request: Cfdi40SignRequest,
  custody: Custody,
  options: SealOptions = {},
): Promise<Cfdi40SealSignature> {
  try {
    const { organizationId } = actor;
    const { preSeal, originalString } = request;
    const clock = options.clock ?? (() => new Date());
    if (!canManageCsd(actor.role)) throw fail("CSD_FORBIDDEN");
    if (!isPreSealCfdi40(preSeal))
      throw fail("PRE_SEAL_CFDI_REQUIRED", "Comprobante");
    if (
      !isCfdi40OriginalString(originalString) ||
      originalString.preSealSha256 !== preSeal.sha256 ||
      originalString.noCertificado !== preSeal.certificate.noCertificado ||
      !originalString.value.includes(`|${preSeal.certificate.noCertificado}|`)
    )
      throw fail("ORIGINAL_STRING_INVALID", "CadenaOriginal");
    const { environment, provider } = custody;
    if (!custody.available || !environment || !provider)
      throw fail("CSD_SERVICE_UNAVAILABLE");
    // resolveCustody already refuses this; repeated so no custody object can enable it. Fiscal
    // PRODUCTION also waits for the evidence gates (CSD type verified by a reliable source,
    // official CSD fixture, real PostgreSQL concurrency): never the env provider.
    if (
      environment === "PRODUCTION" &&
      (provider.provider === "env" ||
        !productionLegalGateSatisfied ||
        pendingProductionSigningGates().length > 0)
    )
      throw fail("CSD_SERVICE_UNAVAILABLE");
    const issuerRfc = preSealIssuerRfc(preSeal);

    return await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "CsdCertificate"
        WHERE "organizationId" = ${organizationId} AND "status" = 'ACTIVE'
        FOR SHARE`;
      if (locked.length !== 1) throw fail("CSD_NOT_CONFIGURED");
      const csdCertificateId = locked[0].id;
      const row = await tx.csdCertificate.findFirst({
        where: { id: csdCertificateId, organizationId, status: "ACTIVE" },
        select: {
          environment: true,
          certificateDer: true,
          certificateSha256: true,
          serialNumberHex: true,
          certificateNumber: true,
          rfc: true,
          privateKey: {
            select: {
              envelopeVersion: true,
              algorithm: true,
              ciphertext: true,
              iv: true,
              authTag: true,
              wrappedDek: true,
              kekProvider: true,
              kekId: true,
              kekVersion: true,
              aadVersion: true,
            },
          },
        },
      });
      if (!row) throw fail("CSD_NOT_CONFIGURED");
      if (row.environment !== environment)
        throw fail("CSD_ENVIRONMENT_MISMATCH");
      // §C.2 effective state, computed now, under the lock.
      const state = await readCsdState(
        tx,
        actor,
        custody,
        clock(),
        options.env,
      );
      if (state.id !== csdCertificateId) throw fail("CSD_NOT_VALID");
      if (state.status === "EXPIRED") throw fail("CSD_EXPIRED");
      if (state.status !== "VALID")
        throw fail(
          state.invalidReason === "KEY_UNAVAILABLE"
            ? "CSD_KEY_UNAVAILABLE"
            : "CSD_NOT_VALID",
        );

      // The stored certificate is the one its record describes, an RSA end-entity
      // certificate of 2048–8192 bits (same rules as configuration, §M step 5)…
      const der = Buffer.from(row.certificateDer);
      const mismatch = () =>
        fail("CSD_CERTIFICATE_MISMATCH", "Comprobante/@Certificado");
      let x509;
      try {
        x509 = parseCertificate(der).x509;
      } catch {
        throw mismatch();
      }
      if (
        sha256(der) !== row.certificateSha256 ||
        x509.serialNumber.toUpperCase() !== row.serialNumberHex.toUpperCase() ||
        certificateNumberFromSerial(x509.serialNumber) !== row.certificateNumber
      )
        throw mismatch();
      // …and exactly the certificate written in the CFDI (a pre-seal XML built before a
      // replacement carries the previous one and must be rebuilt).
      if (
        preSeal.certificate.certificadoBase64 !== der.toString("base64") ||
        preSeal.certificate.noCertificado !== row.certificateNumber
      )
        throw mismatch();
      const rfc = certificateRfc(der);
      if (!rfc || rfc !== row.rfc || issuerRfc !== row.rfc)
        throw fail("CSD_RFC_MISMATCH", "Emisor/@Rfc");
      // §M.0: SANDBOX signs only with demonstrated test certificates; PRODUCTION never.
      if (
        isIssuedByTestAuthority(x509, custody.authorities) !==
        (environment === "SANDBOX")
      )
        throw fail("CSD_ENVIRONMENT_MISMATCH");
      const envelope = row.privateKey;
      if (
        !envelope ||
        envelope.kekProvider !== provider.provider ||
        !provider.canUnwrap({
          provider: envelope.kekProvider,
          keyId: envelope.kekId,
          keyVersion: envelope.kekVersion,
        })
      )
        throw fail("CSD_KEY_UNAVAILABLE");
      // Validity again at the instant the key is about to be opened.
      const signingTime = clock();
      const problems = certificateBindingProblems(
        {
          noCertificado: row.certificateNumber,
          certificadoBase64: der.toString("base64"),
        },
        signingTime,
      );
      if (problems.includes("OUTSIDE_VALIDITY"))
        throw fail(
          signingTime.getTime() >= new Date(x509.validTo).getTime()
            ? "CSD_EXPIRED"
            : "CSD_NOT_VALID",
        );
      if (problems.length) throw mismatch();

      let signature: Buffer;
      try {
        signature = await signWithCustodiedKey(
          provider,
          {
            organizationId,
            csdCertificateId,
            certificateSha256: row.certificateSha256,
            environment,
          },
          envelope,
          x509,
          originalString.bytes,
          options.openKey,
        );
      } catch (error) {
        throw error instanceof CsdSigningError
          ? fail(signingFailures[error.reason])
          : fail("CFDI_SEAL_FAILED");
      }
      return Object.freeze({
        sello: signature.toString("base64"),
        algorithm: cfdiSealAlgorithm.name,
        csdCertificateId,
        environment,
        noCertificado: row.certificateNumber,
      });
    }, transactionOptions);
  } catch (error) {
    throw coded(error);
  }
}

/**
 * The seal of a CFDI (FASE5C §15–16): cadena original of the pre-seal XML with the official
 * SAT XSLT, signature with the custodied CSD (signCfdi40OriginalString), Sello inserted into
 * the same pre-seal tree and the final XML verified on its own (createSealedCfdi40). Returns
 * a SealedCfdi40Xml registered by ORBIT, or throws a coded Cfdi40Error; nothing is stored.
 * Audited as cfdi.sealed / cfdi.seal.failed with ids, environment and code only.
 * `invoiceId` must be resolved by the server (never a client value).
 */
export async function sealCfdi40WithActiveCsd(
  db: Db,
  actor: CsdActor,
  request: { preSeal: PreSealCfdi40Xml; invoiceId: string | null },
  custody: Custody,
  options: SealOptions = {},
): Promise<SealedCfdi40Xml> {
  let signature: Cfdi40SealSignature | null = null;
  try {
    const bundle = await loadCfdi40XsltBundle();
    const originalString = generateCfdi40OriginalString(request.preSeal, {
      engine: cfdi40XsltEngine,
      bundle,
    });
    signature = await signCfdi40OriginalString(
      db,
      actor,
      { preSeal: request.preSeal, originalString },
      custody,
      options,
    );
    const sealed = createSealedCfdi40(
      request.preSeal,
      originalString,
      signature.sello,
      compileCfdi40Xslt(cfdi40XsltEngine, bundle),
    );
    await recordAuditEvent(db, {
      action: "cfdi.sealed",
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      targetId: request.invoiceId,
      metadata: {
        certificateId: signature.csdCertificateId,
        environment: signature.environment,
      },
    });
    return sealed;
  } catch (error) {
    const failure = coded(error);
    const code = failure.issues[0]?.code ?? "CFDI_SEAL_FAILED";
    try {
      await recordAuditEvent(db, {
        action: "cfdi.seal.failed",
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        targetId: request.invoiceId,
        result: code === "CSD_FORBIDDEN" ? "DENIED" : "FAILURE",
        metadata: {
          errorCode: code,
          certificateId: signature?.csdCertificateId,
          environment: signature?.environment ?? custody.environment,
        },
      });
    } catch {
      // The seal failure is what the caller reports; audit storage failures are not.
    }
    throw failure;
  }
}
