import type { Prisma } from "@/generated/prisma/client";
import { isSecretKey, redactText } from "./security/redact";

// Fase 5C.2 §6: catalog of security audit events. Each action fixes its scope, target
// type and the only metadata keys it may keep. TENANT events need the Organization
// resolved by the server; ACCOUNT events belong to the actor and have none.
// Reserved actions document the CSD/stamping events of a later phase: they cannot be
// recorded until that phase defines and implements them.
type AuditDefinition = {
  scope: "TENANT" | "ACCOUNT";
  targetType: string;
  metadata: readonly string[];
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
  "csd.configured": {
    scope: "TENANT",
    targetType: "CsdCertificate",
    metadata: [],
    reserved: true,
  },
  "csd.revoked": {
    scope: "TENANT",
    targetType: "CsdCertificate",
    metadata: [],
    reserved: true,
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
/**
 * Keeps only the catalog's metadata keys, with bounded scalar values or short string
 * lists, redacted: no document, payload or secret fits. Secret keys are rejected even
 * if a catalog lists them.
 */
export function sanitizeAuditMetadata(
  action: AuditAction,
  metadata: AuditEventInput["metadata"],
): Prisma.InputJsonObject | undefined {
  const allowed: readonly string[] = auditCatalog[action].metadata;
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!allowed.includes(key) || isSecretKey(key)) continue;
    if (typeof value === "string") output[key] = redactText(value, 120);
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
