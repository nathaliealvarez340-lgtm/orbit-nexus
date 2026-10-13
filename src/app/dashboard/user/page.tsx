import { requirePageTenant } from "@/lib/tenant";
import { tenantPlan } from "@/services/plans";
import { UserSettings } from "@/components/forms/user-settings";
import { PageHeader } from "@/components/dashboard/page-header";
import { PreferencesSettings } from "@/components/experience/preferences-settings";
import { preferencesForSession } from "@/services/user-preferences";
import { translate } from "@/lib/i18n";
import { getDb } from "@/lib/db";
export default async function Page() {
  const tenant = await requirePageTenant();
  const [preference, subscription, account] = await Promise.all([
    preferencesForSession(),
    tenantPlan(),
    getDb().user.findUniqueOrThrow({
      where: { id: tenant.userId },
      select: { givenName: true, familyName: true },
    }),
  ]);
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Administración"
        title={translate(preference.locale, "settings", "title")}
        copy={translate(preference.locale, "settings", "description")}
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
        givenName={account.givenName}
        familyName={account.familyName}
        name={tenant.user.name}
        email={tenant.user.email}
        accent={preference?.accent ?? "PURPLE"}
      />
      <PreferencesSettings initial={preference} />
    </div>
  );
}
