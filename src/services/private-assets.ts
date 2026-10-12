import "server-only";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { getDb } from "@/lib/db";
import { requireAdmin, requireTenant } from "@/lib/tenant";
import { requireInvoicePlan } from "./plans";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { documentFields, validateUpload } from "@/lib/upload-validation";
import { recordAuditEvent } from "@/lib/audit";
import { logSafeError } from "@/lib/security/redact";
import {
  precreationCsfExpiresAt,
  precreationCsfReference,
} from "@/lib/csf/precreation";
import { purgeAbandonedClientCsf } from "./client-csf-precreation";
// Uploading only stores the document privately; reading a constancia requires a
// separate, explicit consent (Fase 5C D11). Client CSFs follow the client permissions.
export async function uploadPrivateAsset(
  file: File,
  kind: "CSF" | "CLIENT_CSF" | "INVOICE_LOGO",
) {
  const { organizationId, userId, role } =
    kind === "INVOICE_LOGO"
      ? await requireInvoicePlan()
      : await requireTenant();
  if (kind !== "CLIENT_CSF") requireAdmin(role);
  await enforceRateLimit("asset:" + userId, 15, 3600);
  if (kind === "INVOICE_LOGO" && file.size > 2 * 1024 * 1024)
    throw new ApiError(400, "El logo debe ser menor a 2 MB.");
  let upload;
  try {
    upload = await validateUpload(file, kind);
    if (kind === "CSF" || kind === "CLIENT_CSF") {
      const pdf = await PDFDocument.load(upload.content);
      if (!pdf.getPageCount()) throw new Error();
    } else {
      const decoder = sharp(upload.content, { limitInputPixels: 4000000 });
      const meta = await decoder.metadata();
      if (
        !meta.hasAlpha ||
        (meta.width ?? 0) > 2000 ||
        (meta.height ?? 0) > 2000 ||
        (await decoder.stats()).isOpaque
      )
        throw new Error();
    }
  } catch {
    throw new ApiError(
      400,
      kind !== "INVOICE_LOGO"
        ? "Sube una constancia PDF válida, no cifrada, de hasta 10 MB."
        : "Sube un logo PNG/WEBP transparente de hasta 2000 × 2000 px y 2 MB.",
    );
  }
  const data = documentFields(upload);
  const stored = await getDb().$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { ...data, organizationId, uploadedById: userId, kind },
      select: { id: true, fileName: true, createdAt: true },
    });
    if (kind !== "INVOICE_LOGO")
      await recordAuditEvent(tx, {
        action: "csf.uploaded",
        organizationId,
        actorUserId: userId,
        targetId: doc.id,
        metadata: {
          purpose: kind === "CSF" ? "FISCAL_PROFILE" : "CLIENT",
          mimeType: data.mimeType,
          sizeBytes: data.size,
          malwareScan: upload.malwareScan,
        },
      });
    return doc;
  });
  const response = { id: stored.id, fileName: stored.fileName };
  if (kind !== "CLIENT_CSF") return response;
  // A client CSF may be uploaded before its client exists: the reference lets this user
  // link it when creating the client, until it expires (CLIENT-CSF-PRECREATION.md).
  try {
    await purgeAbandonedClientCsf();
  } catch (error) {
    logSafeError("client-csf-purge", error);
  }
  return {
    ...response,
    precreationCsfReference: precreationCsfReference({
      organizationId,
      userId,
      documentId: stored.id,
    }),
    expiresAt: precreationCsfExpiresAt(stored.createdAt).toISOString(),
  };
}
