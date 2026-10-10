import { apiError } from "@/lib/http";
import { organizationAuditEvents } from "@/services/audit";
// GET /api/audit-events?limit=&before= → AuditEventPage of the active Organization (OWNER/ADMIN).
export async function GET(request: Request) {
  try {
    return Response.json(
      await organizationAuditEvents(new URL(request.url).searchParams),
    );
  } catch (e) {
    return apiError(e);
  }
}
