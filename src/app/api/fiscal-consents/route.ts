import { assertSameOrigin, readJson } from "@/lib/http";
import { codedApiError } from "@/lib/invoice-api";
import { createFiscalConsent } from "@/services/fiscal-documents";
// POST /api/fiscal-consents → 201 FiscalDocumentConsent. Organization and user come from the session.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await createFiscalConsent(await readJson(request)), {
      status: 201,
    });
  } catch (e) {
    return codedApiError(e);
  }
}
