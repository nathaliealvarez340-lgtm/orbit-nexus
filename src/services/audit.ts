import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { listAuditEvents } from "./audit-events";

/** Audit trail of the active Organization; OWNER and ADMIN only. */
export async function organizationAuditEvents(query: URLSearchParams) {
  const { organizationId, userId, role } = await requireTenant();
  if (role !== "OWNER" && role !== "ADMIN")
    throw new ApiError(
      403,
      "Solo un administrador puede consultar la auditoría.",
    );
  await enforceRateLimit("audit-read:" + userId, 60, 60);
  return listAuditEvents(getDb(), organizationId, {
    limit: query.get("limit"),
    before: query.get("before"),
  });
}
