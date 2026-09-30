import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError } from "@/lib/http";
export async function tenantPlan() {
  const tenant = await requireTenant();
  const subscription = await getDb().subscription.findUnique({
    where: { organizationId: tenant.organizationId },
  });
  return { ...tenant, plan: subscription?.plan ?? ("FREE" as const) };
}
export async function requireInvoicePlan() {
  const tenant = await tenantPlan();
  if (tenant.plan === "FREE")
    throw new ApiError(
      403,
      "La facturación a clientes está disponible en PRO y MAX.",
    );
  return tenant;
}
