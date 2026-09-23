import { PageHeader } from "@/components/dashboard/page-header";
import { InvoiceForm } from "@/components/forms/invoice-form";
import { requirePageTenant } from "@/lib/tenant";
export default async function StampingPage() {
  await requirePageTenant();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Portal propio"
        title="Timbrado CFDI"
        copy="Calculadora de conceptos con vista previa local. La emisión y validación fiscal requieren una integración PAC."
      />
      <InvoiceForm />
    </div>
  );
}
