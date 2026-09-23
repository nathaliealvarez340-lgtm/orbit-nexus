import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { getFiscalProfile, saveFiscalProfile } from "@/services/fiscal";
export async function GET() {
  try {
    return Response.json(await getFiscalProfile());
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const data = await readJson(request);
    return Response.json(
      await saveFiscalProfile(
        data,
        typeof data?.documentId === "string" ? data.documentId : undefined,
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
