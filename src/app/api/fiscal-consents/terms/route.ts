import { codedApiError } from "@/lib/invoice-api";
import { fiscalConsentTerms } from "@/services/fiscal-documents";
// GET /api/fiscal-consents/terms?purpose=FISCAL_PROFILE_PREFILL|CLIENT_FISCAL_PREFILL
export async function GET(request: Request) {
  try {
    return Response.json(
      await fiscalConsentTerms(
        new URL(request.url).searchParams.get("purpose"),
      ),
    );
  } catch (e) {
    return codedApiError(e);
  }
}
