import { assertSameOrigin, readJson } from "@/lib/http";
import { invoiceApiError } from "@/lib/invoice-api";
import {
  deactivateInvoiceConcept,
  updateInvoiceConcept,
} from "@/services/invoice-concepts";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    return Response.json(
      await updateInvoiceConcept(
        (await context.params).id,
        await readJson(request),
      ),
    );
  } catch (e) {
    return invoiceApiError(e);
  }
}
// Deactivates (active = false); invoices keep their own line snapshots.
export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    return Response.json(
      await deactivateInvoiceConcept((await context.params).id),
    );
  } catch (e) {
    return invoiceApiError(e);
  }
}
