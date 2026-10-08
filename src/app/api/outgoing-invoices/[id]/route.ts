import { assertSameOrigin, readJson } from "@/lib/http";
import { invoiceApiError, invoiceStudioBodyLimit } from "@/lib/invoice-api";
import {
  getInvoiceDraftDetail,
  updateInvoiceDraft,
} from "@/services/outgoing-invoices";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json(await getInvoiceDraftDetail((await params).id));
  } catch (e) {
    return invoiceApiError(e);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    return Response.json(
      await updateInvoiceDraft(
        (await params).id,
        await readJson(request, invoiceStudioBodyLimit),
      ),
    );
  } catch (e) {
    return invoiceApiError(e);
  }
}
