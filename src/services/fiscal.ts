import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant, requireAdmin } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { fiscalSchema } from "@/lib/validation";
import { validateUpload, UploadValidationError } from "@/lib/upload-validation";
import { assertCfdi40Document } from "@/lib/cfdi";
import { z } from "zod";
import { addressShape } from "@/lib/phase3-validation";
import { revertReadyInvoices } from "./outgoing-invoices";

// Issuer data copied into invoice snapshots; changing any of them invalidates READY.
const issuerFiscalFields = [
  "rfc",
  "legalName",
  "personType",
  "fiscalRegime",
  "postalCode",
] as const;

export async function getFiscalProfile() {
  const { organizationId } = await requireTenant();
  return getDb().fiscalProfile.findFirst({ where: { organizationId } });
}
export async function saveFiscalProfile(input: unknown, documentId?: string) {
  const { organizationId, userId, role } = await requireTenant();
  requireAdmin(role);
  await enforceRateLimit("fiscal:" + userId, 20, 60);
  const { confirmed, ...data } = fiscalSchema.parse(input);
  const extended = z
    .object({
      ...addressShape,
      csfDocumentId: z.string().max(100).optional(),
      // Fase 5C §8.7: reviewed extraction the confirmed data came from.
      extractionId: z.string().min(1).max(100).optional(),
    })
    .parse(input);
  const { csfDocumentId: requestedCsf, extractionId, ...address } = extended;
  void confirmed;
  return getDb().$transaction(async (tx) => {
    let csfDocumentId = requestedCsf;
    if (
      csfDocumentId &&
      !(await tx.document.findFirst({
        where: {
          id: csfDocumentId,
          organizationId,
          kind: "CSF",
          mimeType: "application/pdf",
        },
      }))
    )
      throw new ApiError(404, "Constancia no disponible para esta empresa.");
    if (extractionId) {
      const extraction = await tx.fiscalDocumentExtraction.findFirst({
        where: {
          id: extractionId,
          organizationId,
          purpose: "FISCAL_PROFILE_PREFILL",
        },
        select: {
          documentId: true,
          document: { select: { kind: true, mimeType: true } },
        },
      });
      if (!extraction)
        throw new ApiError(404, "Extracción no disponible para esta empresa.");
      if (
        !csfDocumentId &&
        extraction.document.kind === "CSF" &&
        extraction.document.mimeType === "application/pdf"
      )
        csfDocumentId = extraction.documentId;
    }
    if (
      documentId &&
      !(await tx.uploadedFiscalDocument.findFirst({
        where: { id: documentId, organizationId },
      }))
    )
      throw new ApiError(404, "Documento no disponible.");
    const previous = await tx.fiscalProfile.findUnique({
      where: { organizationId },
    });
    const provenance = {
      confirmedAt: new Date(),
      confirmedById: userId,
      ...(extractionId ? { sourceExtractionId: extractionId } : {}),
      ...(csfDocumentId ? { csfDocumentId } : {}),
    };
    const result = await tx.fiscalProfile.upsert({
      where: { organizationId },
      create: { ...data, ...address, ...provenance, organizationId, userId },
      update: { ...data, ...address, ...provenance },
    });
    if (documentId)
      await tx.uploadedFiscalDocument.updateMany({
        where: { id: documentId, organizationId },
        data: { isConfirmed: true, confirmedAt: new Date() },
      });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "FISCAL_PROFILE_UPDATED",
        entityType: "FiscalProfile",
        entityId: result.id,
      },
    });
    // Contract §11.3: a READY invoice whose issuer data changed must be revalidated.
    if (
      previous &&
      issuerFiscalFields.some((key) => previous[key] !== result[key])
    )
      await revertReadyInvoices(tx, {
        organizationId,
        userId,
        reason: "FISCAL_PROFILE_UPDATED",
      });
    return { ok: true };
  });
}
export async function uploadFiscalDocument(file: File) {
  const { organizationId, userId, role } = await requireTenant();
  requireAdmin(role);
  await enforceRateLimit("fiscal-upload:" + userId, 10, 3600);
  let data;
  try {
    data = await validateUpload(file, true);
  } catch (e) {
    throw new ApiError(
      e instanceof UploadValidationError ? e.status : 400,
      (e as Error).message,
    );
  }
  // Fase 5C D11: storing a document never extracts its data. Party data is read only
  // after explicit consent, through /api/fiscal-consents and /api/fiscal-extractions.
  if (data.mimeType === "application/xml") {
    if (data.size > 1024 * 1024)
      throw new ApiError(400, "El XML fiscal debe ser menor a 1 MB.");
    try {
      assertCfdi40Document(data.content.toString("utf8"));
    } catch {
      throw new ApiError(400, "El archivo no es un CFDI 4.0 válido.");
    }
  }
  return getDb().$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { ...data, organizationId, uploadedById: userId, kind: "FISCAL" },
    });
    const fiscal = await tx.uploadedFiscalDocument.create({
      data: {
        organizationId,
        userId,
        documentId: doc.id,
        fileName: data.fileName,
        mimeType: data.mimeType,
        storageKey: "db:" + doc.id,
        extractedData: {},
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "FISCAL_DOCUMENT_UPLOADED",
        entityType: "UploadedFiscalDocument",
        entityId: fiscal.id,
      },
    });
    return { id: fiscal.id, documentId: doc.id };
  });
}
