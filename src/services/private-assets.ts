import "server-only";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { getDb } from "@/lib/db";
import { requireAdmin, requireTenant } from "@/lib/tenant";
import { requireInvoicePlan } from "./plans";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { validateUpload } from "@/lib/upload-validation";
export async function uploadPrivateAsset(
  file: File,
  kind: "CSF" | "INVOICE_LOGO",
) {
  const { organizationId, userId, role } =
    kind === "INVOICE_LOGO"
      ? await requireInvoicePlan()
      : await requireTenant();
  requireAdmin(role);
  await enforceRateLimit("asset:" + userId, 15, 3600);
  if (kind === "INVOICE_LOGO" && file.size > 2 * 1024 * 1024)
    throw new ApiError(400, "El logo debe ser menor a 2 MB.");
  let data;
  try {
    data = await validateUpload(file);
    if (kind === "CSF") {
      if (data.mimeType !== "application/pdf") throw new Error();
      const pdf = await PDFDocument.load(data.content);
      if (!pdf.getPageCount()) throw new Error();
    } else {
      if (!["image/png", "image/webp"].includes(data.mimeType))
        throw new Error();
      const decoder = sharp(data.content, { limitInputPixels: 4000000 });
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
      kind === "CSF"
        ? "Sube una constancia PDF válida, no cifrada, de hasta 10 MB."
        : "Sube un logo PNG/WEBP transparente de hasta 2000 × 2000 px y 2 MB.",
    );
  }
  const doc = await getDb().document.create({
    data: { ...data, organizationId, uploadedById: userId, kind },
    select: { id: true, fileName: true },
  });
  return doc;
}
