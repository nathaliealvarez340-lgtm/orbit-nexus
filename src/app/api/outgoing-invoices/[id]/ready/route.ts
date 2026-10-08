import { ApiError, assertSameOrigin, readBody } from "@/lib/http";
import { invoiceApiError } from "@/lib/invoice-api";
import { markInvoiceReady } from "@/services/outgoing-invoices";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    // Optional body { expectedUpdatedAt } guards against marking a stale review.
    const raw = Buffer.from(await readBody(request, 4096))
      .toString("utf8")
      .trim();
    let body: unknown = {};
    try {
      if (raw) body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "Solicitud inválida.");
    }
    return Response.json(await markInvoiceReady((await params).id, body));
  } catch (e) {
    return invoiceApiError(e);
  }
}
