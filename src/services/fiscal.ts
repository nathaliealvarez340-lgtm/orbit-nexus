import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant, requireAdmin } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { fiscalSchema } from "@/lib/validation";
import { validateUpload, UploadValidationError } from "@/lib/upload-validation";
import { readCfdiReceiver } from "@/lib/cfdi";
export async function getFiscalProfile() {
  const { organizationId } = await requireTenant();
  return getDb().fiscalProfile.findFirst({ where: { organizationId } });
}
export async function saveFiscalProfile(input: unknown, documentId?: string) {
  const { organizationId, userId, role } = await requireTenant();
  requireAdmin(role);
  await enforceRateLimit("fiscal:" + userId, 20, 60);
  const { confirmed, ...data } = fiscalSchema.parse(input);
  void confirmed;
  return getDb().$transaction(async (tx) => {
    if (
      documentId &&
      !(await tx.uploadedFiscalDocument.findFirst({
        where: { id: documentId, organizationId },
      }))
    )
      throw new ApiError(404, "Documento no disponible.");
    const result = await tx.fiscalProfile.upsert({
      where: { organizationId },
      create: { ...data, organizationId, userId, confirmedAt: new Date() },
      update: { ...data, confirmedAt: new Date() },
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
  let extractedData: Record<string, string> = {};
  if (data.mimeType === "application/xml") {
    if (data.size > 1024 * 1024)
      throw new ApiError(400, "El XML fiscal debe ser menor a 1 MB.");
    const xml = data.content.toString("utf8");
    let receiver;
    try {
      receiver = readCfdiReceiver(xml);
    } catch {
      throw new ApiError(
        400,
        "No se encontraron datos válidos del receptor en este CFDI 4.0.",
      );
    }
    extractedData = Object.fromEntries(
      Object.entries({
        rfc: receiver.Rfc,
        legalName: receiver.Nombre,
        postalCode: receiver.DomicilioFiscalReceptor,
        fiscalRegime: receiver.RegimenFiscalReceptor,
        cfdiUse: receiver.UsoCFDI,
        personType: receiver.Rfc.length === 13 ? "INDIVIDUAL" : "COMPANY",
      })
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, String(v).slice(0, 250)]),
    );
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
        extractedData,
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
    return { id: fiscal.id };
  });
}
