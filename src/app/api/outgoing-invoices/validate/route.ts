import { assertSameOrigin, readJson } from "@/lib/http";
import { invoiceApiError, invoiceStudioBodyLimit } from "@/lib/invoice-api";
import { validateInvoiceDraft } from "@/services/outgoing-invoices";
// Validates without persisting; structural problems come back as validation issues.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(
      await validateInvoiceDraft(
        await readJson(request, invoiceStudioBodyLimit),
      ),
    );
  } catch (e) {
    return invoiceApiError(e);
  }
}
