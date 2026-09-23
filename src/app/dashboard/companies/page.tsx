import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { invoiceAdapters } from "@/services/invoice-provider/assisted";
import { requirePageTenant } from "@/lib/tenant";
export default async function Page() {
  await requirePageTenant();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Cobertura"
        title="Empresas compatibles"
        copy="Portales oficiales con facturación asistida. La emisión se completa en el sitio de cada comercio."
      />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {invoiceAdapters.map((c) => (
          <article className="surface p-5" key={c.id}>
            <div className="flex justify-between">
              <span className="grid size-11 place-items-center rounded-xl bg-white/[.05] font-semibold text-violet-300">
                {c.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="text-xs text-violet-300">Asistida</span>
            </div>
            <h2 className="mt-6 font-medium">{c.name}</h2>
            <p className="mt-3 text-xs leading-6 text-zinc-500">
              Datos del ticket:{" "}
              {c.requiredFields.map((f) => f.label).join(" · ")}. También
              necesitas tu perfil fiscal.
            </p>
            <a
              href={c.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 flex items-center gap-2 text-xs text-violet-300"
            >
              Ver portal oficial <ExternalLink className="size-3" />
            </a>
          </article>
        ))}
      </section>
      <p className="text-sm text-zinc-500">
        Otros comercios: integración pendiente. No se ejecutan automatizaciones
        ni scraping.
      </p>
    </div>
  );
}
