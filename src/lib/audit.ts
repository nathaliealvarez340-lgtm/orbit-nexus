import type { Prisma } from "@/generated/prisma/client";
import { isSecretKey, redactText } from "./security/redact";

// Fase 5C.2 §6: catalog of security audit events. Each action fixes its scope, target
// type and the only metadata keys it may keep. TENANT events need the Organization
// resolved by the server; ACCOUNT events belong to the actor and have none.
// Reserved actions document the stamping events of a later phase: they cannot be
// recorded until that phase defines and implements them.
type AuditDefinition = {
  scope: "TENANT" | "ACCOUNT";
  targetType: string;
  metadata: readonly string[];
  /** Metadata keys holding a server-generated UUID, kept verbatim (never redacted text). */
  identifiers?: readonly string[];
  reserved?: true;
};
export const auditCatalog = {
  "fiscal_profile.updated": {
    scope: "TENANT",
    targetType: "FiscalProfile",
    metadata: ["changedFields", "source"],
  },
  "client.fiscal.updated": {
    scope: "TENANT",
    targetType: "Client",
    metadata: ["operation", "changedFields", "source"],
  },
  "csf.uploaded": {
    scope: "TENANT",
    targetType: "Document",
    metadata: ["purpose", "mimeType", "sizeBytes", "malwareScan"],
  },
  "csf.extraction_requested": {
    scope: "TENANT",
    targetType: "FiscalDocumentConsent",
    metadata: ["purpose", "status", "parserVersion", "reused", "reason"],
  },
  "csf.confirmed": {
    scope: "TENANT",
    targetType: "FiscalDocumentExtraction",
    metadata: ["purpose", "subject"],
  },
  "legal.accepted": {
    scope: "ACCOUNT",
    targetType: "LegalAcceptance",
    metadata: ["document", "version"],
  },
  "privacy.accepted": {
    scope: "ACCOUNT",
    targetType: "LegalAcceptance",
    metadata: ["document", "version"],
  },
  "sensitive_asset.uploaded": {
    scope: "TENANT",
    targetType: "Document",
    metadata: ["kind", "mimeType", "sizeBytes", "malwareScan"],
  },
  "sensitive_asset.deleted": {
    scope: "TENANT",
    targetType: "Document",
    metadata: ["kind", "reason"],
  },
  // Fase 5C.3 §Q. Never the RFC, password, key, file contents or cryptographic material.
  "csd.configuration.started": {
    scope: "TENANT",
    targetType: "CsdCertificate",
    metadata: ["replace", "reason"],
  },
  "csd.configured": {
    scope: "TENANT",
    targetType: "CsdCertificate",
    metadata: ["certificateNumber", "environment", "validTo", "created"],
  },
  "csd.configuration.failed": {
    scope: "TENANT",
    targetType: "CsdCertificate",
    metadata: ["errorCode", "stage"],
  },
  "csd.replaced": {
    scope: "TENANT",
    targetType: "CsdCertificate",
    metadata: ["previousCertificateId", "certificateNumber"],
    identifiers: ["previousCertificateId"],
  },
  "csd.disabled": {
    scope: "TENANT",
    targetType: "CsdCertificate",
    metadata: ["certificateNumber", "reason"],
  },
  // Fase 5C.6: seal of a CFDI with the custodied CSD. Only ids, the fiscal environment and a
  // result code: never the Sello, cadena original, XML, certificate or key material.
  "cfdi.sealed": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: ["certificateId", "environment"],
    identifiers: ["certificateId"],
  },
  "cfdi.seal.failed": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: ["errorCode", "certificateId", "environment"],
    identifiers: ["certificateId"],
  },
  // Fase 5C.7: official XSD validation of a sealed CFDI. A short hash of the XSD set and a
  // result code only: never the XML, Sello, certificate, RFC, cadena or amounts.
  "cfdi.xsd.validated": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: ["xsdBundle"],
  },
  "cfdi.xsd.failed": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: ["errorCode", "xsdBundle"],
  },
  // Fase 5C.8: PAC stamping (sandbox). Ids, provider, fiscal environment and codes only; the
  // UUID only once verified (FASE5C §25.1). Never the token, XML, Sello, CSD, RFC, amounts or a
  // raw PAC response.
  "cfdi.stamp.authorized": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: [
      "stampAttemptId",
      "invoiceVersion",
      "termsVersion",
      "environment",
    ],
    identifiers: ["stampAttemptId"],
  },
  "cfdi.stamp.started": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: ["stampAttemptId", "provider", "environment", "reconciliation"],
    identifiers: ["stampAttemptId"],
  },
  "cfdi.stamp.succeeded": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: [
      "stampAttemptId",
      "provider",
      "environment",
      "resultCode",
      "uuid",
    ],
    identifiers: ["stampAttemptId", "uuid"],
  },
  "cfdi.stamp.rejected": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: [
      "stampAttemptId",
      "provider",
      "environment",
      "resultCode",
      "providerCode",
      "failureClass",
    ],
    identifiers: ["stampAttemptId"],
  },
  "cfdi.stamp.unknown": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: [
      "stampAttemptId",
      "provider",
      "environment",
      "resultCode",
      "providerCode",
      "detailCode",
    ],
    identifiers: ["stampAttemptId"],
  },
  "invoice.stamp_authorized": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: [],
    reserved: true,
  },
  "invoice.stamped": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: [],
    reserved: true,
  },
  "invoice.cancelled": {
    scope: "TENANT",
    targetType: "StampedInvoice",
    metadata: [],
    reserved: true,
  },
} as const satisfies Record<string, AuditDefinition>;

export type AuditAction = keyof typeof auditCatalog;
export type AuditResult = "SUCCESS" | "FAILURE" | "DENIED";
export type AuditValue = string | number | boolean | readonly string[];
export type AuditEventInput = {
  action: AuditAction;
  /** Server-resolved Organization; never a value received from the client. */
  organizationId: string | null;
  actorUserId: string | null;
  targetId?: string | null;
  result?: AuditResult;
  metadata?: Record<string, AuditValue | null | undefined>;
};

export class AuditError extends Error {}

const maxMetadataBytes = 2048;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/**
 * Keeps only the catalog's metadata keys, with bounded scalar values or short string
 * lists, redacted: no document, payload or secret fits. Secret keys are rejected even
 * if a catalog lists them.
 */
export function sanitizeAuditMetadata(
  action: AuditAction,
  metadata: AuditEventInput["metadata"],
): Prisma.InputJsonObject | undefined {
  const definition: AuditDefinition = auditCatalog[action];
  const allowed = definition.metadata;
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!allowed.includes(key) || isSecretKey(key)) continue;
    if (definition.identifiers?.includes(key)) {
      if (typeof value === "string" && uuidPattern.test(value))
        output[key] = value;
    } else if (typeof value === "string") output[key] = redactText(value, 120);
    else if (typeof value === "number" && Number.isFinite(value))
      output[key] = value;
    else if (typeof value === "boolean") output[key] = value;
    else if (Array.isArray(value))
      output[key] = value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 20)
        .map((item) => redactText(item, 60));
  }
  if (!Object.keys(output).length) return undefined;
  return JSON.stringify(output).length > maxMetadataBytes
    ? { truncated: true }
    : output;
}

/** Names (never values) of the fields that differ; every field on creation. */
export function changedFieldNames(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
  fields: readonly string[],
) {
  const comparable = (value: unknown) =>
    value instanceof Date ? value.toISOString() : JSON.stringify(value ?? null);
  return [...new Set(fields)]
    .filter(
      (field) =>
        !previous || comparable(previous[field]) !== comparable(next[field]),
    )
    .sort();
}

type AuditWriter = { auditEvent: Prisma.TransactionClient["auditEvent"] };

/**
 * Records one audit event. Pass the transaction of the audited change so both commit
 * or roll back together; DENIED/FAILURE events are written outside the failed work.
 */
export async function recordAuditEvent(
  db: AuditWriter,
  input: AuditEventInput,
) {
  const definition: AuditDefinition = auditCatalog[input.action];
  if (!definition) throw new AuditError("AUDIT_ACTION_UNKNOWN");
  if (definition.reserved) throw new AuditError("AUDIT_ACTION_RESERVED");
  if (definition.scope === "TENANT" && !input.organizationId)
    throw new AuditError("AUDIT_ORGANIZATION_REQUIRED");
  if (definition.scope === "ACCOUNT" && input.organizationId)
    throw new AuditError("AUDIT_ACCOUNT_EVENT_HAS_NO_ORGANIZATION");
  const metadata = sanitizeAuditMetadata(input.action, input.metadata);
  return db.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: definition.targetType,
      targetId: input.targetId ?? null,
      result: input.result ?? "SUCCESS",
      ...(metadata ? { metadata } : {}),
    },
    select: { id: true },
  });
}
