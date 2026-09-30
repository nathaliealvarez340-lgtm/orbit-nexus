import { apiError, assertSameOrigin, readJson } from "@/lib/http";
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
    return Response.json(await createInvoiceDraft(await readJson(request)), {
      status: 201,
    });
  } catch (e) {
    return apiError(e);
  }
}
