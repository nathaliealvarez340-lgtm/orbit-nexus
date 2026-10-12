import { csdApiError } from "@/lib/csd/errors";
import { getMyCsdHistory } from "@/services/csd";
// GET → CsdHistoryItem[] of the session Organization, newest first, at most 50.
export async function GET() {
  try {
    return Response.json(await getMyCsdHistory());
  } catch (e) {
    return csdApiError(e);
  }
}
