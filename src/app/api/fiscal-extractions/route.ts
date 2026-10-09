import { assertSameOrigin, readJson } from "@/lib/http";
import { codedApiError } from "@/lib/invoice-api";
import { createFiscalExtraction } from "@/services/fiscal-documents";
// POST /api/fiscal-extractions { consentId } → 201 FiscalExtractionResult (200 when it already exists).
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { created, result } = await createFiscalExtraction(
      await readJson(request),
    );
    return Response.json(result, { status: created ? 201 : 200 });
  } catch (e) {
    return codedApiError(e);
  }
}
