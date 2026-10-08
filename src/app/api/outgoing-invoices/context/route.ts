import { invoiceApiError } from "@/lib/invoice-api";
import { invoiceStudioContext } from "@/services/outgoing-invoices";
export async function GET() {
  try {
    return Response.json(await invoiceStudioContext());
  } catch (e) {
    return invoiceApiError(e);
  }
}
