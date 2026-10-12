import { csdApiError } from "@/lib/csd/errors";
import { getCsdCustodyTerms } from "@/services/csd";
// GET → CsdCustodyTerms: current, versioned custody text (provisional, pending legal review).
export async function GET() {
  try {
    return Response.json(await getCsdCustodyTerms());
  } catch (e) {
    return csdApiError(e);
  }
}
