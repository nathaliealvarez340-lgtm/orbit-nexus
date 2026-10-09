import "server-only";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireAdmin, requireTenant } from "@/lib/tenant";
import { enforceRateLimit } from "@/lib/http";
import { InvoiceApiError as CodedApiError } from "@/lib/invoice-api";
import { extractPdfLines } from "@/lib/csf/pdf-text";
import {
  CSF_PARSER_VERSION,
  extractionFieldKeys,
  parseCsfText,
  type CsfParseResult,
} from "@/lib/csf/parser";
import { postalCodeIndex } from "@/lib/sat/postal-codes";
import {
  privacyNoticeBlocksProcessing,
  privacyNoticeVersion,
} from "@/lib/privacy-notice";
import { findEditableClient } from "./clients";
import type {
  ExtractedFiscalField,
  ExtractedFiscalRegime,
  FiscalConsentPurpose,
  FiscalConsentTerms,
  FiscalDocumentConsent,
  FiscalExtractionFieldKey,
  FiscalExtractionResult,
  FiscalFieldComparison,
} from "@/types/fiscal-identity";
import type {
  FiscalDocumentConsent as ConsentRow,
  FiscalDocumentExtraction as ExtractionRow,
} from "@/generated/prisma/client";

// Contract §9.1 and §10.3, verbatim. Changing a text requires a new version.
const consentTerms: Record<
  FiscalConsentPurpose,
  { version: string; text: string }
> = {
  FISCAL_PROFILE_PREFILL: {
    version: "fiscal-profile-prefill-2026-10-v1",
    text: "Autorizo a ORBIT NEXUS a leer esta Constancia de Situación Fiscal con la finalidad de extraer y prellenar mis datos fiscales. Podré revisar y corregir la información antes de guardarla. Esta autorización no implica la emisión de CFDI ni autoriza el uso de mi e.firma.",
  },
  CLIENT_FISCAL_PREFILL: {
    version: "client-fiscal-prefill-2026-10-v1",
    text: "Declaro que cuento con facultades o una base legítima para proporcionar y tratar esta información fiscal del cliente con la finalidad de administrar y preparar sus comprobantes fiscales en ORBIT NEXUS.",
  },
};
// Documents each purpose may read. Only PDF constancias are processed (§8, D11).
const purposeDocumentKinds: Record<FiscalConsentPurpose, string[]> = {
  FISCAL_PROFILE_PREFILL: ["CSF", "FISCAL"],
  CLIENT_FISCAL_PREFILL: ["CLIENT_CSF"],
};
const purposeSchema = z.enum([
  "FISCAL_PROFILE_PREFILL",
  "CLIENT_FISCAL_PREFILL",
]);
const unreadableMessage: Record<FiscalConsentPurpose, string> = {
  FISCAL_PROFILE_PREFILL:
    "No pudimos identificar todos los datos de tu Constancia. Puedes revisarlos y completarlos manualmente.",
  CLIENT_FISCAL_PREFILL:
    "No pudimos identificar todos los datos de la Constancia del cliente. Puedes revisarlos y completarlos manualmente.",
};

/** null until the operator publishes a valid Privacy Notice (D12). */
export const currentPrivacyNoticeVersion = () => privacyNoticeVersion();
// D12: development and sandbox continue; fiscal production is blocked without a notice.
function assertPrivacyNoticeForProduction() {
  if (privacyNoticeBlocksProcessing())
    throw new CodedApiError(
      503,
      "La lectura automática de documentos fiscales no está disponible hasta publicar el Aviso de Privacidad vigente.",
      "PRIVACY_NOTICE_MISSING",
    );
}

export async function fiscalConsentTerms(
  purpose: unknown,
): Promise<FiscalConsentTerms> {
  await requireTenant();
  const parsed = purposeSchema.safeParse(purpose);
  if (!parsed.success)
    throw new CodedApiError(
      400,
      "Finalidad de autorización inválida.",
      "INVALID_PURPOSE",
    );
  const terms = consentTerms[parsed.data];
  return {
    purpose: parsed.data,
    consentVersion: terms.version,
    privacyNoticeVersion: currentPrivacyNoticeVersion(),
    text: terms.text,
  };
}

const consentRequestSchema = z.object({
  documentId: z.string().trim().min(1).max(100),
  purpose: purposeSchema,
  clientId: z.string().trim().min(1).max(100).optional(),
  accepted: z.literal(true, {
    error: "Marca la casilla de autorización para continuar.",
  }),
  consentVersion: z.string().min(1).max(100),
  privacyNoticeVersion: z.string().min(1).max(100).nullable(),
});

function consentDto(row: ConsentRow): FiscalDocumentConsent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    documentId: row.documentId,
    purpose: row.purpose,
    clientId: row.clientId,
    consentVersion: row.consentVersion,
    privacyNoticeVersion: row.privacyNoticeVersion,
    acceptedAt: row.acceptedAt.toISOString(),
  };
}

/**
 * Same server-side permissions as the data each purpose may change: the fiscal profile
 * requires OWNER/ADMIN; a client CSF requires the permission to edit that client.
 */
async function assertPurposePermission(
  organizationId: string,
  role: string,
  purpose: FiscalConsentPurpose,
  clientId: string | null | undefined,
) {
  if (purpose === "FISCAL_PROFILE_PREFILL") return requireAdmin(role);
  if (
    !clientId ||
    !(await findEditableClient(getDb(), organizationId, clientId))
  )
    throw new CodedApiError(
      404,
      "Cliente no disponible.",
      "CLIENT_NOT_AVAILABLE",
    );
}

/** Records an explicit, versioned authorization. Organization and user come from the session. */
export async function createFiscalConsent(
  input: unknown,
): Promise<FiscalDocumentConsent> {
  const { organizationId, userId, role } = await requireTenant();
  await enforceRateLimit("fiscal-consent:" + userId, 30, 60);
  const data = consentRequestSchema.parse(input);
  if (data.purpose === "FISCAL_PROFILE_PREFILL") requireAdmin(role);
  assertPrivacyNoticeForProduction();
  if (data.consentVersion !== consentTerms[data.purpose].version)
    throw new CodedApiError(
      409,
      "El texto de autorización cambió; revísalo de nuevo.",
      "CONSENT_VERSION_OUTDATED",
    );
  if (data.privacyNoticeVersion !== currentPrivacyNoticeVersion())
    throw new CodedApiError(
      409,
      "El Aviso de Privacidad cambió; revísalo de nuevo.",
      "PRIVACY_NOTICE_OUTDATED",
    );
  const db = getDb();
  const document = await db.document.findFirst({
    where: { id: data.documentId, organizationId },
    select: { kind: true, mimeType: true },
  });
  if (!document)
    throw new CodedApiError(
      404,
      "Documento no disponible.",
      "DOCUMENT_NOT_AVAILABLE",
    );
  if (
    !purposeDocumentKinds[data.purpose].includes(document.kind) ||
    document.mimeType !== "application/pdf"
  )
    throw new CodedApiError(
      409,
      "Solo se pueden leer Constancias de Situación Fiscal en PDF.",
      "DOCUMENT_NOT_SUPPORTED",
    );
  if (data.purpose === "CLIENT_FISCAL_PREFILL") {
    if (!data.clientId)
      throw new CodedApiError(
        400,
        "Selecciona el cliente de esta Constancia.",
        "CLIENT_REQUIRED",
      );
    await assertPurposePermission(
      organizationId,
      role,
      data.purpose,
      data.clientId,
    );
  } else if (data.clientId)
    throw new CodedApiError(
      400,
      "La autorización del perfil fiscal no se asocia a un cliente.",
      "CLIENT_NOT_ALLOWED",
    );
  return db.$transaction(async (tx) => {
    const consent = await tx.fiscalDocumentConsent.create({
      data: {
        organizationId,
        userId,
        documentId: data.documentId,
        purpose: data.purpose,
        clientId: data.clientId ?? null,
        consentVersion: data.consentVersion,
        privacyNoticeVersion: data.privacyNoticeVersion,
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "FISCAL_CONSENT_ACCEPTED",
        entityType: "FiscalDocumentConsent",
        entityId: consent.id,
      },
    });
    return consentDto(consent);
  });
}

const extractionRequestSchema = z.object({
  consentId: z.string().trim().min(1).max(100),
});

/** Processes a consented document. Repeating the request returns the stored result. */
export async function createFiscalExtraction(
  input: unknown,
): Promise<{ created: boolean; result: FiscalExtractionResult }> {
  const { organizationId, userId, role } = await requireTenant();
  await enforceRateLimit("fiscal-extraction:" + userId, 10, 60);
  const { consentId } = extractionRequestSchema.parse(input);
  assertPrivacyNoticeForProduction();
  const db = getDb();
  const consent = await db.fiscalDocumentConsent.findFirst({
    where: { id: consentId, organizationId },
  });
  // Without a consent of this user in this Organization the document is never processed.
  if (!consent || consent.userId !== userId)
    throw new CodedApiError(
      404,
      "No existe una autorización vigente para leer este documento.",
      "CONSENT_REQUIRED",
    );
  await assertPurposePermission(
    organizationId,
    role,
    consent.purpose,
    consent.clientId,
  );
  if (consent.consentVersion !== consentTerms[consent.purpose].version)
    throw new CodedApiError(
      409,
      "La autorización corresponde a un texto anterior; autoriza de nuevo.",
      "CONSENT_VERSION_OUTDATED",
    );
  const existing = await db.fiscalDocumentExtraction.findFirst({
    where: { organizationId, consentId, parserVersion: CSF_PARSER_VERSION },
    orderBy: { createdAt: "desc" },
  });
  if (existing)
    return { created: false, result: await extractionDto(existing) };
  const document = await db.document.findFirst({
    where: { id: consent.documentId, organizationId },
    select: { content: true, mimeType: true },
  });
  if (!document || document.mimeType !== "application/pdf")
    throw new CodedApiError(
      404,
      "Documento no disponible.",
      "DOCUMENT_NOT_AVAILABLE",
    );
  const postalCodes = await postalCodeIndex();
  let parsed: CsfParseResult;
  try {
    parsed = parseCsfText(await extractPdfLines(document.content), {
      isKnownPostalCode: (code) => postalCodes.has(code),
    });
  } catch {
    // Unreadable or damaged PDF: nothing is invented and manual capture remains available.
    parsed = parseCsfText([]);
  }
  const row = await db.$transaction(async (tx) => {
    const extraction = await tx.fiscalDocumentExtraction.create({
      data: {
        organizationId,
        consentId,
        documentId: consent.documentId,
        purpose: consent.purpose,
        clientId: consent.clientId,
        createdById: userId,
        status: parsed.status,
        parserVersion: CSF_PARSER_VERSION,
        fields: parsed.fields,
        regimes: parsed.regimes,
        message:
          parsed.status === "PROCESSED"
            ? null
            : unreadableMessage[consent.purpose],
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "FISCAL_EXTRACTION_COMPLETED",
        entityType: "FiscalDocumentExtraction",
        entityId: extraction.id,
        metadata: { status: parsed.status },
      },
    });
    return extraction;
  });
  return { created: true, result: await extractionDto(row) };
}

export async function getFiscalExtraction(
  id: string,
): Promise<FiscalExtractionResult> {
  const { organizationId, role } = await requireTenant();
  const row = await getDb().fiscalDocumentExtraction.findFirst({
    where: { id, organizationId },
  });
  if (!row)
    throw new CodedApiError(
      404,
      "Extracción no disponible.",
      "EXTRACTION_NOT_AVAILABLE",
    );
  // Detected (unconfirmed) data is visible only to whoever may confirm it.
  await assertPurposePermission(
    organizationId,
    role,
    row.purpose,
    row.clientId,
  );
  return extractionDto(row);
}

const comparableFields: FiscalExtractionFieldKey[] = extractionFieldKeys.filter(
  (key) => key !== "operationsStartDate",
);
/** Compares detected values with the currently confirmed master data (§8.6, §10.7). */
async function extractionDto(
  row: ExtractionRow,
): Promise<FiscalExtractionResult> {
  const fields = row.fields as unknown as Record<
    FiscalExtractionFieldKey,
    ExtractedFiscalField
  >;
  const regimes = row.regimes as unknown as ExtractedFiscalRegime[];
  const db = getDb();
  const record: Record<string, unknown> | null =
    row.purpose === "CLIENT_FISCAL_PREFILL" && row.clientId
      ? await db.client.findFirst({
          where: { id: row.clientId, organizationId: row.organizationId },
        })
      : await db.fiscalProfile.findFirst({
          where: {
            organizationId: row.organizationId,
            confirmedAt: { not: null },
          },
        });
  const current = record
    ? Object.fromEntries(
        [...comparableFields, "fiscalRegime"].map((key) => [
          key,
          record[key] === null || record[key] === undefined
            ? null
            : String(record[key]),
        ]),
      )
    : null;
  const comparison: FiscalFieldComparison[] = [];
  if (current) {
    for (const key of comparableFields) {
      const detected = fields[key]?.value ?? null;
      if (detected === null) continue;
      const value = current[key] ?? null;
      comparison.push({
        field: key,
        current: value,
        detected,
        changed: value !== detected,
      });
    }
    const codes = [...new Set(regimes.map((r) => r.code).filter(Boolean))];
    if (codes.length) {
      const detected = codes.join(", ");
      const value = current.fiscalRegime ?? null;
      comparison.push({
        field: "fiscalRegime",
        current: value,
        detected,
        changed: !value || !codes.includes(value),
      });
    }
  }
  return {
    id: row.id,
    documentId: row.documentId,
    consentId: row.consentId,
    purpose: row.purpose,
    clientId: row.clientId,
    status: row.status,
    parserVersion: row.parserVersion,
    fields,
    regimes,
    comparison,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}
