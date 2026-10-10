import { assertSameOrigin, readJson } from "@/lib/http";
import { codedApiError } from "@/lib/invoice-api";
import { acceptMyLegalDocument, myLegalAcceptances } from "@/services/legal";
// GET → LegalAcceptanceState[] of the signed-in user for the current versions.
export async function GET() {
  try {
    return Response.json(await myLegalAcceptances());
  } catch (e) {
    return codedApiError(e);
  }
}
// POST { document, version, contentHash } → 201 new acceptance, 200 if already accepted.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const acceptance = await acceptMyLegalDocument(await readJson(request));
    return Response.json(acceptance, {
      status: acceptance.created ? 201 : 200,
    });
  } catch (e) {
    return codedApiError(e);
  }
}
