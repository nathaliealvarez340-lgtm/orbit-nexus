import { Check, ScanLine } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { UploadZone } from "@/components/dashboard/upload-zone";

export default function NewTicketPage() {
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Nuevo comprobante"
        title="Captura un ticket"
        copy="Orbit detectará empresa, fecha, folio y total antes de pedirte confirmación."
      />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_.7fr]">
        <section className="surface p-6">
          <UploadZone />
        </section>
        <aside className="surface h-fit p-6">
          <p className="text-sm font-medium">Proceso de análisis</p>
          <div className="mt-6 space-y-5">
            {[
              ["1", "Documento recibido", Check],
              ["2", "Lectura OCR", ScanLine],
              ["3", "Validación de datos", Check],
              ["4", "Preparación de factura", Check],
            ].map(([n, label, Icon]) => {
              const I = Icon as typeof Check;
              return (
                <div key={String(n)} className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full border border-white/10 font-mono text-xs text-zinc-500">
                    {String(n)}
                  </span>
                  <span className="text-sm text-zinc-400">{String(label)}</span>
                  <I className="ml-auto size-4 text-zinc-700" />
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
