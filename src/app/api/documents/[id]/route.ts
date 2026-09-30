import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { apiError, ApiError } from "@/lib/http";
import { requireInvoicePlan } from "@/services/plans";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { organizationId } = await requireTenant();
    const { id } = await params;
    const doc = await getDb().document.findFirst({
      where: { id, organizationId },
    });
    if (!doc) throw new ApiError(404, "Documento no disponible.");
    // Outgoing invoice assets also retain plan protection through direct URLs.
    if (
      doc.kind === "INVOICE_LOGO" ||
      (await getDb().stampedInvoice.findFirst({
        where: {
          organizationId,
          OR: [{ xmlDocumentId: id }, { pdfDocumentId: id }],
        },
        select: { id: true },
      }))
    )
      await requireInvoicePlan();
    const inline =
      doc.mimeType.startsWith("image/") &&
      new URL(request.url).searchParams.get("preview") === "1";
    return new Response(new Uint8Array(doc.content), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(doc.size),
        "Content-Disposition":
          (inline ? "inline" : "attachment") +
          "; filename*=UTF-8''" +
          encodeURIComponent(doc.fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
