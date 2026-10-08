import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { invoiceApiError, invoiceStudioBodyLimit } from "@/lib/invoice-api";
import {
  createInvoiceDraft,
  issuedInvoices,
} from "@/services/outgoing-invoices";
export async function GET() {
  try {
    return Response.json(await issuedInvoices());
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { created, result } = await createInvoiceDraft(
      await readJson(request, invoiceStudioBodyLimit),
      request.headers.get("idempotency-key"),
    );
    // 200 means an Idempotency-Key replay returned the draft created earlier.
    return Response.json(result, { status: created ? 201 : 200 });
  } catch (e) {
    return invoiceApiError(e);
  }
}
