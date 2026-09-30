import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import {
  saveInvoiceSettings,
  outgoingContext,
} from "@/services/outgoing-invoices";
export async function GET() {
  try {
    return Response.json((await outgoingContext()).settings);
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await saveInvoiceSettings(await readJson(request)));
  } catch (e) {
    return apiError(e);
  }
}
