import { requirePageTenant } from "@/lib/tenant";
import { tenantPlan } from "@/services/plans";
import { outgoingContext } from "@/services/outgoing-invoices";
import { PlanLock } from "@/components/dashboard/plan-lock";
import { PageHeader } from "@/components/dashboard/page-header";
import { InvoiceSettingsForm } from "@/components/forms/invoice-settings-form";
export default async function Page() {
  await requirePageTenant();
  if ((await tenantPlan()).plan === "FREE") return <PlanLock />;
  const { settings, tenant } = await outgoingContext();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Facturación"
        title="Administración de facturas"
        copy="Logo, prefijo, secuencia automática y plantilla de tu empresa."
      />
      <InvoiceSettingsForm
        initial={
          settings
            ? {
                prefix: settings.prefix,
                color: settings.color,
                nextNumber: settings.nextNumber,
                logoDocumentId: settings.logoDocumentId,
              }
            : null
        }
        readOnly={tenant.role === "MEMBER"}
      />
    </div>
  );
}
