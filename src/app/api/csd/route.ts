import { assertSameOrigin } from "@/lib/http";
import { csdApiError } from "@/lib/csd/errors";
import { configureMyCsd, getMyCsdState } from "@/services/csd";
// GET → CsdState of the session Organization (OWNER/ADMIN). Fase 5C.3 §O.
export async function GET() {
  try {
    return Response.json(await getMyCsdState());
  } catch (e) {
    return csdApiError(e);
  }
}
// POST multipart (certificate, privateKey, password, custodyTermsVersion, accepted=true,
// optional replace=true + expectedActiveCsdId) → 200 ConfigureCsdResponse. Requires a
// recent sign-in; the password is used once and never stored or returned.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await configureMyCsd(request));
  } catch (e) {
    return csdApiError(e);
  }
}
