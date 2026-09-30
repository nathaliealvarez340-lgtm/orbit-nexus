import { requirePageTenant } from "@/lib/tenant";
import { SupportCenter } from "@/components/dashboard/support-center";
import { PageHeader } from "@/components/dashboard/page-header";
export default async function Page() {
  await requirePageTenant();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Ayuda"
        title="Centro de soporte"
        copy="Encuentra instrucciones para tu operación diaria."
      />
      <SupportCenter />
    </div>
  );
}
