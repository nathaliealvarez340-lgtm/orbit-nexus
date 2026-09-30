import { requirePageTenant } from "@/lib/tenant";
import { notifications } from "@/services/notifications";
import { NotificationList } from "@/components/dashboard/notification-list";
import { PageHeader } from "@/components/dashboard/page-header";
export default async function Page() {
  await requirePageTenant();
  const items = await notifications();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Actividad"
        title="Notificaciones"
        copy="Novedades de la empresa activa. Tu estado de lectura es personal."
      />
      <NotificationList
        items={items.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          href: n.href,
          date: n.createdAt.toLocaleString("es-MX", {
            timeZone: "America/Mexico_City",
          }),
          read: n.reads.length > 0,
        }))}
      />
    </div>
  );
}
