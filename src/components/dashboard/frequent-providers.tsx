import { invoiceAdapters } from "@/services/invoice-provider/assisted";
export function FrequentProviders() {
  return (
    <details className="surface p-5">
      <summary className="cursor-pointer text-sm font-medium">
        Proveedores frecuentes · Facturación asistida
      </summary>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {invoiceAdapters.map((c) => (
          <article key={c.id} className="rounded-xl border border-white/10 p-4">
            <h3 className="font-medium">{c.name}</h3>
            <p className="mt-2 text-xs text-zinc-400">{c.domain}</p>
            <p className="mt-2 text-xs text-zinc-400">
              Estado: asistida · Automatización pendiente
            </p>
            <a
              href={c.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm text-violet-300 underline"
            >
              Abrir portal oficial
            </a>
          </article>
        ))}
      </div>
      <p className="mt-4 text-xs text-zinc-400">
        El usuario completa la solicitud en el portal del comercio. No se envían
        datos ni se ejecutan acciones automáticamente.
      </p>
    </details>
  );
}
