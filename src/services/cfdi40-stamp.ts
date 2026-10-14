import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type StampAttempt,
  type StampedInvoice,
  type StampedInvoiceConcept,
} from "@/generated/prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCustody, type Custody } from "@/lib/csd/custody";
import { buildPreSealCfdi40 } from "@/lib/cfdi40/build";
import { loadCfdi40Catalogs } from "@/lib/cfdi40/catalogs";
import { certificateBindingFromDer } from "@/lib/cfdi40/certificate-binding";
import { Cfdi40Error, cfdi40Issue } from "@/lib/cfdi40/errors";
import { compileCfdi40Xslt } from "@/lib/cfdi40/original-string";
import { orbitInvoiceForCfdi } from "@/lib/cfdi40/orbit-invoice";
import { pacSubmission, validateSealedCfdi40Xsd } from "@/lib/cfdi40/schema";
import { restoreSealedCfdi40 } from "@/lib/cfdi40/sealed";
import {
  StampedCfdiError,
  verifyStampedCfdi40,
  verifyTfdForSentCfdi40,
  type StampedVerificationDeps,
} from "@/lib/cfdi40/stamped";
import {
  loadCfdi40XsdEngine,
  loadStampedVerificationDeps,
} from "@/lib/cfdi40/xsd-engine";
import { loadCfdi40XsdBundle } from "@/lib/cfdi40/xsd-resources";
import { cfdi40XsltEngine } from "@/lib/cfdi40/xslt-engine";
import { loadCfdi40XsltBundle } from "@/lib/cfdi40/xslt-resources";
import type { XsdValidatedCfdi40 } from "@/lib/cfdi40/types";
import { createSwPacAdapter, swMaxRequestBytes } from "@/lib/pac/sw/adapter";
import { resolveSwPacConfiguration } from "@/lib/pac/sw/config";
import {
  customIdFor,
  type PacProvider,
  type PacResultCode,
  type PacStampOutcome,
} from "@/lib/pac/types";
import { privacyNoticeBlocksProcessing } from "@/lib/privacy-notice";
import {
  stampAuthorizationTerms,
  stampAuthorizationTermsSha256,
} from "@/lib/stamping/terms";
import type { InvoiceValidationResult } from "@/types/invoice-studio";
import type {
  InvoiceStampingState,
  PacEnvironment,
  StampAttemptSummary,
  StampBlockingReason,
  StampErrorCode,
  StampResponse,
  StampedInvoiceState,
} from "@/types/stamping";
import { validateSealedCfdi40XsdForInvoice } from "./cfdi40-xsd";
import { sealCfdi40WithActiveCsd } from "./csd-signing";
import { readCsdState, type CsdActor } from "./csd-store";

// Fase 5C.8: PAC stamping in fiscal SANDBOX (docs/tasks/FASE5C8-PAC-SANDBOX.md). Without
// session access so it runs against PGlite: `actor` comes from a server-validated tenant
// (routes: requireTenant + plan), every query is scoped to actor.organizationId, and the
// browser never sends an organization, an idempotency key or a CustomID.
//
// Flow: explicit per-invoice authorization (this exact version and terms text) → one
// StampAttempt per invoice at a time (activeKey, unique; the invoice row is locked while the
// attempt is created and fiscal edits are refused while it is active) → pre-seal XML of the
// locked version → seal with the custodied CSD (5C.6) → official XSD (5C.7) → the exact bytes
// and their hashes are persisted and the attempt becomes SUBMITTING BEFORE any network call →
// PAC → the response is verified against the bytes sent (src/lib/cfdi40/stamped.ts) →
// SUCCEEDED (UUID unique in ORBIT), FAILED (pre-submit or explicit PAC rejection) or UNKNOWN.
// UNKNOWN is never retried blindly nor turned into FAILED: reconciliation re-sends the SAME
// bytes with the SAME CustomID and accepts only verified evidence. The invoice is NOT marked
// ISSUED (sandbox; READY → ISSUED is a later phase).

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
type Env = Record<string, string | undefined>;
export type StampActor = CsdActor;
export type StampInvoiceRecord = StampedInvoice & {
  concepts: StampedInvoiceConcept[];
};

export type StampDependencies = {
  env?: Env;
  clock?: () => Date;
  custody?: Custody;
  /** The PAC; default: the SW sandbox adapter configured from the environment. */
  pac?: PacProvider;
  /** Fiscal revalidation of the stored invoice (routes pass validateStoredInvoice). */
  revalidate: (
    tx: Tx,
    organizationId: string,
    invoice: StampInvoiceRecord,
  ) => Promise<InvoiceValidationResult>;
  verification?: StampedVerificationDeps;
  /** An attempt stuck before submission (PENDING/SIGNING) or in SUBMITTING for longer is stale. */
  staleAfterMs?: number;
};

export class StampServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code:
      StampErrorCode | "INVOICE_NOT_FOUND" | "INVALID_REQUEST",
    message: string,
    public readonly reasons: StampBlockingReason[] = [],
    public readonly validation?: InvoiceValidationResult,
  ) {
    super(message);
    this.name = "StampServiceError";
  }
}

const transactionOptions = { maxWait: 10_000, timeout: 20_000 };
const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const activeKeyOf = (organizationId: string, invoiceId: string) =>
  `${organizationId}:${invoiceId}`;
const canStamp = (role: string) => role === "OWNER" || role === "ADMIN";
const orderedConcepts = {
  concepts: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
};

// Curated messages: never provider text, values or technical detail.
const messages: Partial<Record<string, string>> = {
  PAC_SANDBOX_UNAVAILABLE: "El PAC de pruebas no está configurado.",
  PAC_PRODUCTION_BLOCKED: "El timbrado productivo no está habilitado.",
  PAC_REQUEST_TOO_LARGE:
    "El CFDI excede el tamaño permitido para enviarlo al PAC.",
  PAC_NOT_SUBMITTED: "No fue posible conectar con el PAC; el CFDI no se envió.",
  PAC_AUTH_FAILED:
    "El PAC rechazó la credencial de ORBIT. El CFDI no se timbró.",
  PAC_NO_BALANCE:
    "La cuenta del PAC no tiene timbres disponibles. El CFDI no se timbró.",
  PAC_RATE_LIMITED: "El PAC pidió reintentar más tarde. El CFDI no se timbró.",
  PAC_CFDI_REJECTED:
    "El PAC rechazó el CFDI por una validación fiscal. Revisa la información antes de intentarlo nuevamente.",
  PAC_REQUEST_REJECTED: "El PAC rechazó la solicitud. El CFDI no se timbró.",
  STALE_PRE_SUBMIT: "El intento se interrumpió antes de enviarse al PAC.",
  PAC_SUBMISSION_INTERRUPTED:
    "Estamos verificando el estado de este CFDI. No vuelvas a timbrarlo mientras realizamos la comprobación.",
  PAC_RESPONSE_INCONSISTENT:
    "El PAC devolvió un timbre que no corresponde al CFDI enviado. Requiere revisión antes de continuar.",
  PAC_UUID_CONFLICT:
    "El PAC devolvió un UUID que ORBIT ya tiene registrado. Requiere revisión antes de continuar.",
  STORED_REQUEST_CORRUPT:
    "El CFDI enviado ya no coincide con su registro. Requiere revisión antes de continuar.",
};
const unknownMessage =
  "Estamos verificando el estado de este CFDI. No vuelvas a timbrarlo mientras realizamos la comprobación.";
const failedMessage =
  "No fue posible timbrar el CFDI. Revisa la información indicada antes de intentarlo nuevamente.";

function attemptSummary(
  attempt: StampAttempt,
  now: Date,
  staleAfterMs: number,
): StampAttemptSummary {
  const ended = attempt.status === "FAILED" || attempt.status === "UNKNOWN";
  return {
    id: attempt.id,
    status: attempt.status,
    environment: attempt.environment,
    provider: attempt.provider,
    draftVersion: attempt.invoiceVersion,
    startedAt: attempt.startedAt.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    completedAt: attempt.finishedAt?.toISOString() ?? null,
    error:
      ended && attempt.resultCode
        ? {
            code: attempt.resultCode,
            message:
              messages[attempt.resultCode] ??
              (attempt.status === "UNKNOWN" ? unknownMessage : failedMessage),
          }
        : null,
    canReconcile:
      attempt.status === "UNKNOWN" ||
      (attempt.status === "SUBMITTING" &&
        !!attempt.submittedAt &&
        now.getTime() - attempt.submittedAt.getTime() > staleAfterMs),
  };
}

function invoiceState(invoice: StampedInvoice): StampedInvoiceState {
  // Sandbox stamps never change the invoice: no UUID, ISSUED, stamped date or documents here.
  return {
    id: invoice.id,
    status: invoice.status,
    version: invoice.version,
    uuid: invoice.uuid,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    stampedAt: null,
    fiscalEnvironment: null,
    xmlDocumentId: invoice.xmlDocumentId,
    pdfDocumentId: invoice.pdfDocumentId,
  };
}

/** The PAC of this process (or the injected one), or the reason there is none. */
function pacFor(
  deps: StampDependencies,
): { pac: PacProvider; code: null } | { pac: null; code: PacResultCode } {
  if (deps.pac) return { pac: deps.pac, code: null };
  const configuration = resolveSwPacConfiguration(deps.env ?? process.env);
  if (!configuration.available) return { pac: null, code: configuration.code };
  return { pac: createSwPacAdapter(configuration), code: null };
}

/** Global and Organization gates (FASE5C3 §Z): nothing here touches an invoice. */
async function blockingReasons(
  db: Db,
  actor: StampActor,
  deps: StampDependencies,
): Promise<{
  reasons: StampBlockingReason[];
  environment: PacEnvironment | null;
  pac: PacProvider | null;
  custody: Custody;
}> {
  const env = deps.env ?? process.env;
  // Custody always comes from the process environment (tests inject their own).
  const custody = deps.custody ?? resolveCustody();
  const reasons: StampBlockingReason[] = [];
  if (env.STAMPING_ENABLED?.trim() !== "true")
    reasons.push("STAMPING_DISABLED");
  if (privacyNoticeBlocksProcessing(env))
    reasons.push("PRIVACY_NOTICE_MISSING");
  if (!canStamp(actor.role)) reasons.push("ROLE_NOT_ALLOWED");
  const { pac } = pacFor(deps);
  // Fiscal SANDBOX only in this phase; the custody and the PAC must agree on it.
  const environment = custody.environment;
  if (!pac || pac.environment !== "SANDBOX" || environment !== "SANDBOX")
    reasons.push("PAC_NOT_CONFIGURED");
  const entitlement = await db.stampingEntitlement.findUnique({
    where: { organizationId: actor.organizationId },
  });
  if (
    !entitlement?.enabled ||
    !environment ||
    entitlement.environment !== environment
  )
    reasons.push("ORGANIZATION_NOT_ENTITLED");
  let csdValid = false;
  if (custody.available)
    try {
      const state = await readCsdState(
        db,
        actor,
        custody,
        (deps.clock ?? (() => new Date()))(),
        env,
      );
      csdValid = state.status === "VALID";
    } catch {
      csdValid = false;
    }
  if (!csdValid) reasons.push("CSD_NOT_VALID");
  return { reasons, environment, pac, custody };
}

/** Converts stale attempts of one invoice (inside the caller's transaction). */
async function recoverStale(
  tx: Tx,
  organizationId: string,
  invoiceId: string,
  now: Date,
  staleAfterMs: number,
) {
  const limit = new Date(now.getTime() - staleAfterMs);
  // Nothing was sent before SUBMITTING: a stale PENDING/SIGNING attempt can safely fail.
  await tx.stampAttempt.updateMany({
    where: {
      organizationId,
      invoiceId,
      status: { in: ["PENDING", "SIGNING"] },
      startedAt: { lt: limit },
    },
    data: {
      status: "FAILED",
      failureClass: "PRE_SUBMIT",
      resultCode: "STALE_PRE_SUBMIT",
      activeKey: null,
      finishedAt: now,
    },
  });
  // A stale SUBMITTING attempt may have reached the PAC: it becomes UNKNOWN, never FAILED.
  await tx.stampAttempt.updateMany({
    where: {
      organizationId,
      invoiceId,
      status: "SUBMITTING",
      submittedAt: { lt: limit },
    },
    data: { status: "UNKNOWN", resultCode: "PAC_SUBMISSION_INTERRUPTED" },
  });
}

type StartResult =
  | { replay: StampAttempt }
  | { attempt: StampAttempt; invoice: StampInvoiceRecord };

const lockInvoice = (tx: Tx, organizationId: string, invoiceId: string) =>
  tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "StampedInvoice"
    WHERE "id" = ${invoiceId} AND "organizationId" = ${organizationId}
    FOR UPDATE`;

async function startAttempt(
  db: Db,
  actor: StampActor,
  invoiceId: string,
  expectedVersion: number,
  pac: PacProvider,
  deps: StampDependencies,
): Promise<StartResult> {
  const { organizationId } = actor;
  const now = (deps.clock ?? (() => new Date()))();
  const staleAfterMs = deps.staleAfterMs ?? 120_000;
  const result = await db.$transaction(async (tx) => {
    if (!(await lockInvoice(tx, organizationId, invoiceId)).length)
      throw new StampServiceError(
        404,
        "INVOICE_NOT_FOUND",
        "Factura no disponible.",
      );
    await recoverStale(tx, organizationId, invoiceId, now, staleAfterMs);
    // A refusal is returned, not thrown, so the stale recovery above still commits (nothing
    // else is written before the last check).
    try {
      return await create(tx);
    } catch (error) {
      if (error instanceof StampServiceError) return { refused: error };
      throw error;
    }
  }, transactionOptions);
  if ("refused" in result) throw result.refused;
  return result;

  async function create(tx: Tx): Promise<StartResult> {
    const active = await tx.stampAttempt.findFirst({
      where: { organizationId, invoiceId, activeKey: { not: null } },
    });
    if (active) {
      if (active.status === "UNKNOWN")
        throw new StampServiceError(
          409,
          "RECONCILIATION_REQUIRED",
          unknownMessage,
          ["RECONCILIATION_REQUIRED"],
        );
      if (active.invoiceVersion !== expectedVersion)
        throw new StampServiceError(
          409,
          "VERSION_CONFLICT",
          "La factura cambió; revisa la versión actual antes de timbrar.",
        );
      // Same request again (double click, retry, another tab): the same attempt.
      return { replay: active };
    }
    const invoice = await tx.stampedInvoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: orderedConcepts,
    });
    if (!invoice)
      throw new StampServiceError(
        404,
        "INVOICE_NOT_FOUND",
        "Factura no disponible.",
      );
    if (invoice.version !== expectedVersion)
      throw new StampServiceError(
        409,
        "VERSION_CONFLICT",
        "La factura cambió; revisa la versión actual antes de timbrar.",
      );
    const succeeded = await tx.stampAttempt.findFirst({
      where: {
        organizationId,
        invoiceId,
        invoiceVersion: expectedVersion,
        status: "SUCCEEDED",
      },
    });
    if (succeeded) return { replay: succeeded };
    if (invoice.status !== "READY")
      throw new StampServiceError(
        409,
        "INVOICE_NOT_READY",
        "Solo una factura lista puede timbrarse.",
        ["INVOICE_NOT_READY"],
      );
    if (invoice.documentType !== "I")
      throw new StampServiceError(
        409,
        "STAMPING_NOT_ALLOWED",
        "Este tipo de comprobante todavía no puede timbrarse.",
        ["DOCUMENT_TYPE_NOT_SUPPORTED"],
      );
    const validation = await deps.revalidate(tx, organizationId, invoice);
    if (!validation.canMarkReady)
      throw new StampServiceError(
        422,
        "NOT_READY",
        "Corrige los errores fiscales antes de timbrar.",
        ["INVOICE_NOT_READY"],
        validation,
      );
    const authorizationId = randomUUID();
    const attemptId = randomUUID();
    await tx.stampAuthorization.create({
      data: {
        id: authorizationId,
        organizationId,
        invoiceId,
        invoiceVersion: invoice.version,
        userId: actor.userId,
        termsVersion: stampAuthorizationTerms.version,
        termsSha256: stampAuthorizationTermsSha256,
        acceptedAt: now,
      },
    });
    const attempt = await tx.stampAttempt.create({
      data: {
        id: attemptId,
        organizationId,
        invoiceId,
        invoiceVersion: invoice.version,
        authorizationId,
        requestedById: actor.userId,
        provider: pac.id,
        adapter: pac.adapter,
        environment: pac.environment,
        customId: customIdFor(attemptId),
        activeKey: activeKeyOf(organizationId, invoiceId),
        status: "PENDING",
        startedAt: now,
      },
    });
    await recordAuditEvent(tx, {
      action: "cfdi.stamp.authorized",
      organizationId,
      actorUserId: actor.userId,
      targetId: invoiceId,
      metadata: {
        stampAttemptId: attemptId,
        invoiceVersion: invoice.version,
        termsVersion: stampAuthorizationTerms.version,
        environment: pac.environment,
      },
    });
    await recordAuditEvent(tx, {
      action: "cfdi.stamp.started",
      organizationId,
      actorUserId: actor.userId,
      targetId: invoiceId,
      metadata: {
        stampAttemptId: attemptId,
        provider: pac.id,
        environment: pac.environment,
        reconciliation: false,
      },
    });
    return { attempt, invoice };
  }
}

/** Conditional transition: only from the expected states; false when another process won. */
async function transition(
  db: Db | Tx,
  attempt: StampAttempt,
  from: StampAttempt["status"][],
  data: Prisma.StampAttemptUpdateManyMutationInput,
) {
  const result = await db.stampAttempt.updateMany({
    where: {
      id: attempt.id,
      organizationId: attempt.organizationId,
      status: { in: from },
    },
    data,
  });
  return result.count === 1;
}

const auditSafely = async (
  db: Db,
  input: Parameters<typeof recordAuditEvent>[1],
) => {
  try {
    await recordAuditEvent(db, input);
  } catch {
    // The attempt state is the authority; an audit storage failure never changes it.
  }
};

async function markFailed(
  db: Db,
  actor: StampActor,
  attempt: StampAttempt,
  from: StampAttempt["status"][],
  failure: {
    failureClass: "PRE_SUBMIT" | "REJECTED_RETRYABLE" | "REJECTED_FINAL";
    resultCode: string;
    providerCode?: string | null;
    providerMessage?: string | null;
  },
  now: Date,
) {
  const done = await transition(db, attempt, from, {
    status: "FAILED",
    failureClass: failure.failureClass,
    resultCode: failure.resultCode,
    providerCode: failure.providerCode ?? null,
    providerMessage: failure.providerMessage ?? null,
    activeKey: null,
    finishedAt: now,
  });
  if (done)
    await auditSafely(db, {
      action: "cfdi.stamp.rejected",
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      targetId: attempt.invoiceId,
      result: "FAILURE",
      metadata: {
        stampAttemptId: attempt.id,
        provider: attempt.provider,
        environment: attempt.environment,
        resultCode: failure.resultCode,
        providerCode: failure.providerCode ?? undefined,
        failureClass: failure.failureClass,
      },
    });
}

async function markUnknown(
  db: Db,
  actor: StampActor,
  attempt: StampAttempt,
  from: StampAttempt["status"][],
  detail: {
    resultCode: string;
    providerCode?: string | null;
    detailCode?: string | null;
  },
) {
  const done = await transition(db, attempt, from, {
    status: "UNKNOWN",
    resultCode: detail.resultCode,
    providerCode: detail.providerCode ?? null,
    detailCode: detail.detailCode ?? null,
  });
  if (done)
    await auditSafely(db, {
      action: "cfdi.stamp.unknown",
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      targetId: attempt.invoiceId,
      result: "FAILURE",
      metadata: {
        stampAttemptId: attempt.id,
        provider: attempt.provider,
        environment: attempt.environment,
        resultCode: detail.resultCode,
        providerCode: detail.providerCode ?? undefined,
        detailCode: detail.detailCode ?? undefined,
      },
    });
}

const codeOf = (error: unknown) =>
  error instanceof Cfdi40Error
    ? (error.issues[0]?.code ?? "CFDI_SEAL_FAILED")
    : "CFDI_SEAL_FAILED";

/**
 * Applies a PAC outcome to a SUBMITTING attempt. `reconciliation`: the request repeats an
 * earlier submission, so only verified evidence resolves it; a rejection then proves nothing
 * about the first submission and the attempt stays UNKNOWN.
 */
async function finalize(
  db: Db,
  actor: StampActor,
  attempt: StampAttempt,
  sent: XsdValidatedCfdi40,
  outcome: PacStampOutcome,
  deps: StampDependencies,
  reconciliation: boolean,
) {
  const now = (deps.clock ?? (() => new Date()))();
  const from: StampAttempt["status"][] = ["SUBMITTING"];
  if (outcome.kind === "REJECTED") {
    if (reconciliation)
      return markUnknown(db, actor, attempt, from, {
        resultCode: attempt.resultCode ?? "PAC_SUBMISSION_INTERRUPTED",
        providerCode: outcome.providerCode,
        detailCode: "RECONCILIATION_" + outcome.code,
      });
    return markFailed(
      db,
      actor,
      attempt,
      from,
      {
        failureClass: outcome.retryable
          ? "REJECTED_RETRYABLE"
          : "REJECTED_FINAL",
        resultCode: outcome.code,
        providerCode: outcome.providerCode,
        providerMessage: outcome.providerMessage,
      },
      now,
    );
  }
  let verification: StampedVerificationDeps;
  try {
    verification = deps.verification ?? (await loadStampedVerificationDeps());
  } catch {
    // The PAC may have stamped and ORBIT cannot verify it now: UNKNOWN, never FAILED.
    return markUnknown(db, actor, attempt, from, {
      resultCode:
        outcome.kind === "UNKNOWN" ? outcome.code : "PAC_RESPONSE_INCONSISTENT",
      providerCode: outcome.providerCode,
      detailCode: "VERIFICATION_UNAVAILABLE",
    });
  }
  if (outcome.kind === "UNKNOWN" || !outcome.evidence.cfdi) {
    // A TFD without the CFDI (e.g. duplicate CustomID): evidence for support, never a stamp.
    const partial = outcome.evidence?.tfd;
    let detailCode: string | null = null;
    if (partial)
      try {
        verifyTfdForSentCfdi40(sent, partial, verification);
        detailCode = "TFD_BOUND_WITHOUT_CFDI";
      } catch (error) {
        detailCode =
          error instanceof StampedCfdiError ? error.problem : "TFD_UNVERIFIED";
      }
    return markUnknown(db, actor, attempt, from, {
      resultCode: outcome.code,
      providerCode: outcome.providerCode,
      detailCode,
    });
  }
  let stamped;
  try {
    stamped = verifyStampedCfdi40(sent, outcome.evidence, verification);
  } catch (error) {
    // The PAC answered with a stamp ORBIT cannot verify: it may exist at the SAT. Never FAILED.
    return markUnknown(db, actor, attempt, from, {
      resultCode: "PAC_RESPONSE_INCONSISTENT",
      providerCode: outcome.providerCode,
      detailCode:
        error instanceof StampedCfdiError
          ? error.problem
          : "VERIFICATION_FAILED",
    });
  }
  try {
    const done = await db.$transaction(async (tx) => {
      const ok = await transition(tx, attempt, from, {
        status: "SUCCEEDED",
        resultCode: outcome.code,
        providerCode: outcome.providerCode,
        detailCode: null,
        failureClass: null,
        uuid: stamped.uuid,
        stampedXml: new Uint8Array(stamped.bytes),
        stampedSha256: stamped.sha256,
        stampedAt: stamped.tfd.fechaTimbrado,
        rfcProvCertif: stamped.tfd.rfcProvCertif,
        noCertificadoSat: stamped.tfd.noCertificadoSAT,
        activeKey: null,
        succeededKey: `${attempt.organizationId}:${attempt.invoiceId}:${attempt.invoiceVersion}`,
        finishedAt: now,
      });
      if (ok)
        await recordAuditEvent(tx, {
          action: "cfdi.stamp.succeeded",
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          targetId: attempt.invoiceId,
          metadata: {
            stampAttemptId: attempt.id,
            provider: attempt.provider,
            environment: attempt.environment,
            resultCode: outcome.code,
            uuid: stamped.uuid,
          },
        });
      return ok;
    }, transactionOptions);
    return done;
  } catch (error) {
    // The UUID (unique in ORBIT) already belongs to another attempt: never two invoices with
    // one UUID; this one needs review.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return markUnknown(db, actor, attempt, from, {
        resultCode: "PAC_UUID_CONFLICT",
        providerCode: outcome.providerCode,
      });
    throw error;
  }
}

/** One call to the PAC; a throw from the adapter after sending is UNKNOWN, never FAILED. */
async function submit(
  pac: PacProvider,
  sent: XsdValidatedCfdi40,
  customId: string,
): Promise<PacStampOutcome> {
  try {
    return await pac.stamp({ submission: pacSubmission(sent), customId });
  } catch {
    return {
      kind: "UNKNOWN",
      code: "PAC_CONNECTION_LOST",
      providerCode: null,
      evidence: null,
    };
  }
}

async function runAttempt(
  db: Db,
  actor: StampActor,
  attempt: StampAttempt,
  invoice: StampInvoiceRecord,
  pac: PacProvider,
  custody: Custody,
  deps: StampDependencies,
) {
  const clock = deps.clock ?? (() => new Date());
  const env = deps.env ?? process.env;
  if (!(await transition(db, attempt, ["PENDING"], { status: "SIGNING" })))
    return;
  let sent: XsdValidatedCfdi40;
  try {
    const csd = await db.csdCertificate.findFirst({
      where: { organizationId: actor.organizationId, status: "ACTIVE" },
      select: {
        certificateDer: true,
        certificateSha256: true,
        serialNumberHex: true,
        certificateNumber: true,
      },
    });
    if (!csd)
      throw new Cfdi40Error([
        cfdi40Issue("CSD_NOT_CONFIGURED", "Comprobante/@Certificado", "ORBIT"),
      ]);
    const issuedAt = clock();
    const certificate = certificateBindingFromDer(
      csd.certificateDer,
      csd,
      issuedAt,
    );
    const { xml: preSeal } = buildPreSealCfdi40(orbitInvoiceForCfdi(invoice), {
      issuedAt,
      catalogs: await loadCfdi40Catalogs(),
      certificate,
    });
    const sealed = await sealCfdi40WithActiveCsd(
      db,
      actor,
      { preSeal, invoiceId: attempt.invoiceId },
      custody,
      { env, clock },
    );
    sent = await validateSealedCfdi40XsdForInvoice(db, actor, {
      sealed,
      invoiceId: attempt.invoiceId,
    });
  } catch (error) {
    return markFailed(
      db,
      actor,
      attempt,
      ["SIGNING"],
      { failureClass: "PRE_SUBMIT", resultCode: codeOf(error) },
      clock(),
    );
  }
  if (sent.bytes.byteLength > swMaxRequestBytes)
    return markFailed(
      db,
      actor,
      attempt,
      ["SIGNING"],
      { failureClass: "PRE_SUBMIT", resultCode: "PAC_REQUEST_TOO_LARGE" },
      clock(),
    );
  // The exact bytes and their hashes are persisted BEFORE the network call: from here on the
  // attempt may have reached the PAC.
  const submitting = await transition(db, attempt, ["SIGNING"], {
    status: "SUBMITTING",
    sealedXml: new Uint8Array(sent.bytes),
    requestSha256: sent.sha256,
    preSealSha256: sent.preSealSha256,
    originalStringSha256: sent.originalStringSha256,
    submittedAt: clock(),
    submissionCount: { increment: 1 },
  });
  if (!submitting) return;
  const outcome = await submit(pac, sent, attempt.customId);
  await finalize(db, actor, attempt, sent, outcome, deps, false);
}

async function stampingResponse(
  db: Db,
  organizationId: string,
  invoiceId: string,
  attemptId: string,
  deps: StampDependencies,
): Promise<StampResponse> {
  const [invoice, attempt] = await Promise.all([
    db.stampedInvoice.findFirst({ where: { id: invoiceId, organizationId } }),
    db.stampAttempt.findFirst({ where: { id: attemptId, organizationId } }),
  ]);
  if (!invoice || !attempt)
    throw new StampServiceError(
      404,
      "INVOICE_NOT_FOUND",
      "Factura no disponible.",
    );
  return {
    invoice: invoiceState(invoice),
    attempt: attemptSummary(
      attempt,
      (deps.clock ?? (() => new Date()))(),
      deps.staleAfterMs ?? 120_000,
    ),
  };
}

function parseRequest(input: unknown) {
  const value = input as {
    expectedVersion?: unknown;
    authorization?: { accepted?: unknown; version?: unknown };
  } | null;
  const version = value?.expectedVersion;
  if (
    !value ||
    typeof value !== "object" ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new StampServiceError(400, "INVALID_REQUEST", "Solicitud inválida.");
  // The checkbox starts unchecked; only an explicit acceptance of THESE terms counts.
  if (
    value.authorization?.accepted !== true ||
    value.authorization?.version !== stampAuthorizationTerms.version
  )
    throw new StampServiceError(
      422,
      "STAMPING_NOT_ALLOWED",
      "Confirma la autorización de timbrado de esta factura.",
    );
  return { expectedVersion: version };
}

/**
 * POST /api/outgoing-invoices/[id]/stamp. Requires the explicit authorization of this invoice
 * version; creates at most one active attempt per invoice (a repeated request returns it) and
 * runs it to SUCCEEDED, FAILED or UNKNOWN. Throws StampServiceError for refusals before any
 * attempt exists.
 */
export async function stampInvoice(
  db: Db,
  actor: StampActor,
  invoiceId: string,
  input: unknown,
  deps: StampDependencies,
): Promise<StampResponse> {
  const { expectedVersion } = parseRequest(input);
  const gates = await blockingReasons(db, actor, deps);
  if (gates.reasons.length)
    throw new StampServiceError(
      gates.reasons.includes("ROLE_NOT_ALLOWED") ? 403 : 409,
      gates.reasons.includes("ROLE_NOT_ALLOWED")
        ? "STAMPING_NOT_ALLOWED"
        : gates.reasons.includes("CSD_NOT_VALID") && gates.reasons.length === 1
          ? "CSD_NOT_VALID"
          : "STAMPING_DISABLED",
      "El timbrado no está disponible para esta organización.",
      gates.reasons,
    );
  const pac = gates.pac!;
  const started = await startAttempt(
    db,
    actor,
    invoiceId,
    expectedVersion,
    pac,
    deps,
  );
  if ("replay" in started)
    return stampingResponse(
      db,
      actor.organizationId,
      invoiceId,
      started.replay.id,
      deps,
    );
  await runAttempt(
    db,
    actor,
    started.attempt,
    started.invoice,
    pac,
    gates.custody,
    deps,
  );
  return stampingResponse(
    db,
    actor.organizationId,
    invoiceId,
    started.attempt.id,
    deps,
  );
}

/**
 * POST /api/outgoing-invoices/[id]/stamp/reconcile. For an UNKNOWN attempt (or a SUBMITTING one
 * gone stale): re-sends the SAME persisted bytes with the SAME CustomID. Only verified evidence
 * (the PAC's own duplicate answers return the earlier stamp) resolves it to SUCCEEDED; anything
 * else keeps it UNKNOWN. Never creates a new attempt or a new CFDI.
 */
export async function reconcileStampAttempt(
  db: Db,
  actor: StampActor,
  invoiceId: string,
  deps: StampDependencies,
): Promise<StampResponse> {
  const { organizationId } = actor;
  const gates = await blockingReasons(db, actor, deps);
  const blocking = gates.reasons.filter((r) => r !== "CSD_NOT_VALID");
  if (blocking.length)
    throw new StampServiceError(
      blocking.includes("ROLE_NOT_ALLOWED") ? 403 : 409,
      blocking.includes("ROLE_NOT_ALLOWED")
        ? "STAMPING_NOT_ALLOWED"
        : "STAMPING_DISABLED",
      "El timbrado no está disponible para esta organización.",
      blocking,
    );
  const now = (deps.clock ?? (() => new Date()))();
  const staleAfterMs = deps.staleAfterMs ?? 120_000;
  const claimed = await db.$transaction(async (tx) => {
    if (!(await lockInvoice(tx, organizationId, invoiceId)).length)
      throw new StampServiceError(
        404,
        "INVOICE_NOT_FOUND",
        "Factura no disponible.",
      );
    await recoverStale(tx, organizationId, invoiceId, now, staleAfterMs);
    const attempt = await tx.stampAttempt.findFirst({
      where: { organizationId, invoiceId, activeKey: { not: null } },
    });
    if (!attempt || attempt.status !== "UNKNOWN")
      return { attempt, claimed: false };
    // Claim it: one reconciliation at a time (SUBMITTING again, same bytes and CustomID).
    const ok = await transition(tx, attempt, ["UNKNOWN"], {
      status: "SUBMITTING",
      submittedAt: now,
      submissionCount: { increment: 1 },
    });
    if (ok)
      await recordAuditEvent(tx, {
        action: "cfdi.stamp.started",
        organizationId,
        actorUserId: actor.userId,
        targetId: invoiceId,
        metadata: {
          stampAttemptId: attempt.id,
          provider: attempt.provider,
          environment: attempt.environment,
          reconciliation: true,
        },
      });
    return { attempt, claimed: ok };
  }, transactionOptions);
  const attempt = claimed.attempt;
  if (!attempt) {
    const latest = await db.stampAttempt.findFirst({
      where: { organizationId, invoiceId },
      orderBy: { startedAt: "desc" },
    });
    if (!latest)
      throw new StampServiceError(
        409,
        "INVOICE_NOT_READY",
        "Esta factura no tiene intentos de timbrado.",
      );
    return stampingResponse(db, organizationId, invoiceId, latest.id, deps);
  }
  if (!claimed.claimed)
    return stampingResponse(db, organizationId, invoiceId, attempt.id, deps);
  if (
    !gates.pac ||
    attempt.provider !== gates.pac.id ||
    attempt.environment !== gates.pac.environment
  ) {
    await markUnknown(db, actor, attempt, ["SUBMITTING"], {
      resultCode: attempt.resultCode ?? "PAC_SUBMISSION_INTERRUPTED",
      detailCode: "RECONCILIATION_PROVIDER_MISMATCH",
    });
    return stampingResponse(db, organizationId, invoiceId, attempt.id, deps);
  }
  // Restore exactly the bytes sent: same hash, same signed cadena, Sello verified, XSD again.
  let sent: XsdValidatedCfdi40;
  try {
    const stored = await db.stampAttempt.findFirst({
      where: { id: attempt.id, organizationId },
      select: {
        sealedXml: true,
        requestSha256: true,
        preSealSha256: true,
        originalStringSha256: true,
      },
    });
    if (
      !stored?.sealedXml ||
      !stored.requestSha256 ||
      !stored.preSealSha256 ||
      !stored.originalStringSha256 ||
      sha256(stored.sealedXml) !== stored.requestSha256
    )
      throw new Error("STORED_REQUEST_CORRUPT");
    const stylesheet = compileCfdi40Xslt(
      cfdi40XsltEngine,
      await loadCfdi40XsltBundle(),
    );
    const sealed = restoreSealedCfdi40(
      {
        bytes: new Uint8Array(stored.sealedXml),
        sha256: stored.requestSha256,
        preSealSha256: stored.preSealSha256,
        originalStringSha256: stored.originalStringSha256,
      },
      stylesheet,
    );
    sent = validateSealedCfdi40Xsd(sealed, {
      engine: await loadCfdi40XsdEngine(),
      bundle: await loadCfdi40XsdBundle(),
    });
  } catch {
    await markUnknown(db, actor, attempt, ["SUBMITTING"], {
      resultCode: "STORED_REQUEST_CORRUPT",
    });
    return stampingResponse(db, organizationId, invoiceId, attempt.id, deps);
  }
  const outcome = await submit(gates.pac, sent, attempt.customId);
  await finalize(
    db,
    actor,
    { ...attempt, status: "SUBMITTING" },
    sent,
    outcome,
    deps,
    true,
  );
  return stampingResponse(db, organizationId, invoiceId, attempt.id, deps);
}

/** GET /api/outgoing-invoices/[id]/stamp: availability, terms, invoice and latest attempt. */
export async function invoiceStampingState(
  db: Db,
  actor: StampActor,
  invoiceId: string,
  deps: Omit<StampDependencies, "revalidate">,
): Promise<InvoiceStampingState> {
  const { organizationId } = actor;
  const invoice = await db.stampedInvoice.findFirst({
    where: { id: invoiceId, organizationId },
  });
  if (!invoice)
    throw new StampServiceError(
      404,
      "INVOICE_NOT_FOUND",
      "Factura no disponible.",
    );
  const gates = await blockingReasons(db, actor, {
    ...deps,
    revalidate: async () => {
      throw new Error("unused");
    },
  });
  const latest = await db.stampAttempt.findFirst({
    where: { organizationId, invoiceId },
    orderBy: { startedAt: "desc" },
  });
  const reasons = [...gates.reasons];
  if (invoice.status !== "READY") reasons.push("INVOICE_NOT_READY");
  if (invoice.documentType !== "I") reasons.push("DOCUMENT_TYPE_NOT_SUPPORTED");
  if (latest?.activeKey)
    reasons.push(
      latest.status === "UNKNOWN"
        ? "RECONCILIATION_REQUIRED"
        : "ATTEMPT_IN_PROGRESS",
    );
  return {
    availability: {
      enabled: reasons.length === 0,
      environment: gates.environment,
      reasons,
    },
    authorization: stampAuthorizationTerms,
    invoice: invoiceState(invoice),
    latestAttempt: latest
      ? attemptSummary(
          latest,
          (deps.clock ?? (() => new Date()))(),
          deps.staleAfterMs ?? 120_000,
        )
      : null,
  };
}
