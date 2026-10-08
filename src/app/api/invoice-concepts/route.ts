import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { invoiceApiError } from "@/lib/invoice-api";
import {
  createInvoiceConcept,
  listInvoiceConcepts,
} from "@/services/invoice-concepts";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    return Response.json(
      await listInvoiceConcepts(
        p.get("q") ?? "",
        p.get("includeInactive") === "true",
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await createInvoiceConcept(await readJson(request)), {
      status: 201,
    });
  } catch (e) {
    return invoiceApiError(e);
  }
}
