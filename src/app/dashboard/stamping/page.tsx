import { PageHeader } from "@/components/dashboard/page-header";
import { InvoiceForm } from "@/components/forms/invoice-form";
export default function StampingPage() { return <div className="space-y-7"><PageHeader eyebrow="Portal propio" title="Timbrado CFDI" copy="Prepara un CFDI manual, calcula impuestos y genera una vista previa antes de conectar un PAC." /><InvoiceForm /></div>; }

