import { apiError } from "@/lib/http";
import { getOutgoingInvoice } from "@/services/outgoing-invoices";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(await getOutgoingInvoice((await params).id));
  } catch (e) {
    return apiError(e);
  }
}
