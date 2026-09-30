import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError } from "@/lib/http";
import { fiscalProfileComplete } from "@/lib/fiscal-catalogs";
const events: Record<string, { title: string; href: string }> = {
  TICKET_ANALYZED: { title: "Ticket procesado", href: "/dashboard/tickets/" },
  EXPENSE_CONFIRMED: { title: "Gasto registrado", href: "/dashboard/tickets" },
  INVOICE_COMPLETED: {
    title: "Factura incorporada",
    href: "/dashboard/invoices",
  },
};
export async function notifications() {
  const { organizationId, userId } = await requireTenant(),
    db = getDb();
  // ActivityLog is the authoritative event source. Unique event keys make this replay safe.
  const activity = await db.activityLog.findMany({
    where: { organizationId, action: { in: Object.keys(events) } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  for (const event of activity) {
    const definition = events[event.action],
      eventKey = "activity:" + event.id;
    await db.notification.upsert({
      where: { organizationId_eventKey: { organizationId, eventKey } },
      update: {},
      create: {
        organizationId,
        eventKey,
        title: definition.title,
        message: "Consulta el detalle en tu empresa activa.",
        href:
          definition.href +
          (event.action === "TICKET_ANALYZED" ? (event.entityId ?? "") : ""),
        type: event.action,
        createdAt: event.createdAt,
      },
    });
  }
  const profile = await db.fiscalProfile.findUnique({
    where: { organizationId },
  });
  if (!fiscalProfileComplete(profile)) {
    const eventKey =
      "fiscal-incomplete:" + (profile?.updatedAt.toISOString() ?? "new");
    await db.notification.upsert({
      where: { organizationId_eventKey: { organizationId, eventKey } },
      update: {},
      create: {
        organizationId,
        eventKey,
        title: "Completa el perfil fiscal",
        message: "Revisa dirección, datos fiscales y constancia PDF.",
        href: "/dashboard/fiscal-profile",
        type: "FISCAL_INCOMPLETE",
      },
    });
  }
  return db.notification.findMany({
    where: {
      organizationId,
      ...(fiscalProfileComplete(profile)
        ? { type: { not: "FISCAL_INCOMPLETE" } }
        : {}),
    },
    include: { reads: { where: { userId }, select: { readAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
export async function markNotificationsRead(id?: string) {
  const { organizationId, userId } = await requireTenant(),
    db = getDb();
  const rows = await db.notification.findMany({
    where: { organizationId, ...(id ? { id } : {}) },
    select: { id: true },
  });
  if (id && !rows.length)
    throw new ApiError(404, "Notificación no disponible.");
  await db.notificationRead.createMany({
    data: rows.map((row) => ({
      organizationId,
      userId,
      notificationId: row.id,
    })),
    skipDuplicates: true,
  });
  return { ok: true };
}
