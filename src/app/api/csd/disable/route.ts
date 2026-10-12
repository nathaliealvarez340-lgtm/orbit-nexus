import { assertSameOrigin } from "@/lib/http";
import { csdApiError } from "@/lib/csd/errors";
import { disableMyCsd } from "@/services/csd";
// POST { expectedActiveCsdId, confirm: true } → 200 CsdState. Requires a recent sign-in;
// deletes the encrypted private key in the same transaction (Fase 5C.3 §L).
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await disableMyCsd(request));
  } catch (e) {
    return csdApiError(e);
  }
}
