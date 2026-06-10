import { PageHeader } from "@/components/dashboard/page-header";
import { UploadZone } from "@/components/dashboard/upload-zone";
export default function FiscalDocumentsPage() { return <div className="space-y-7"><PageHeader eyebrow="Extracción asistida" title="Documentos fiscales" copy="Sube XML, PDF o tu Constancia de Situación Fiscal. Confirmaremos cada dato antes de guardarlo." /><section className="surface p-6"><UploadZone fiscal /></section></div>; }

