import { FiscalForm } from "@/components/forms/fiscal-form";
import { PageHeader } from "@/components/dashboard/page-header";
export default function FiscalProfilePage() { return <div className="space-y-7"><PageHeader eyebrow="Identidad fiscal" title="Perfil fiscal" copy="Orbit usará estos datos para preparar facturas. Siempre podrás validarlos antes de emitir." /><FiscalForm /></div>; }

