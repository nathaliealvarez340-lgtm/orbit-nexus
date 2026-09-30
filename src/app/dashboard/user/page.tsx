import { requirePageTenant } from "@/lib/tenant";
import { getDb } from "@/lib/db";
import { tenantPlan } from "@/services/plans";
import { UserSettings } from "@/components/forms/user-settings";
import { PageHeader } from "@/components/dashboard/page-header";
export default async function Page() {
  const tenant = await requirePageTenant();
  const [preference, subscription] = await Promise.all([
    getDb().userPreference.findUnique({ where: { userId: tenant.userId } }),
    tenantPlan(),
  ]);
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Administración"
        title="Usuario"
        copy="Cuenta, seguridad y preferencias personales."
      />
      <div className="surface p-5">
        <p className="font-medium">
          Plan {subscription.plan} · {tenant.organization.name}
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          FREE: tickets, gastos, empresas y clientes. PRO y MAX: preparación de
          facturas a clientes. La activación de planes y los pagos aún no están
          conectados.
        </p>
      </div>
      <UserSettings
        name={tenant.user.name}
        email={tenant.user.email}
        accent={preference?.accent ?? "PURPLE"}
      />
    </div>
  );
}
