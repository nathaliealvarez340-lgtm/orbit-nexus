import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError } from "@/lib/http";

import { matchProvider } from "@/lib/billing-fields";
export async function billingOptions(ticketId: string) {
  const { organizationId } = await requireTenant();
  const db = getDb();
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, organizationId },
    include: { expense: true },
  });
  if (!ticket) throw new ApiError(404, "Ticket no disponible.");
  const [global, frequent] = await Promise.all([
    db.company.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.organizationBillingProvider.findMany({
      where: { organizationId },
      orderBy: [{ favorite: "desc" }, { lastUsedAt: "desc" }],
      take: 100,
    }),
  ]);
  const details = ticket.expense?.details as Record<string, string> | null;
  const suggested = matchProvider(global, {
    name: ticket.expense?.merchant ?? ticket.merchant ?? "",
    rfc: details?.issuerRfc,
    url: ticket.billingUrl,
  });
  return {
    global: global.map((p) => ({
      id: p.id,
      name: p.name,
      portalUrl: p.portalUrl,
      mode: p.automationMode,
    })),
    frequent: frequent.map((p) => ({
      id: p.id,
      name: p.name,
      portalUrl: p.customBillingUrl,
      favorite: p.favorite,
    })),
    suggestedId: suggested?.id ?? null,
    candidateUrl: ticket.billingUrl ?? "",
  };
}
