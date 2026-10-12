import { requirePageTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/dashboard/page-header";
import { CsdManager } from "@/components/csd/csd-manager";
export default async function Page() {
  const { organizationId } = await requirePageTenant();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Seguridad fiscal"
        title="Certificado de Sello Digital"
        copy="Configura y administra el CSD de tu organización. Esta configuración no emite facturas; el timbrado sigue pendiente."
      />
      <CsdManager key={organizationId} />
    </div>
  );
}
