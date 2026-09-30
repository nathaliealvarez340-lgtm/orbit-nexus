import { apiError } from "@/lib/http";
import { monthlyReports } from "@/services/reports";
export async function GET() {
  try {
    return Response.json(await monthlyReports());
  } catch (e) {
    return apiError(e);
  }
}
