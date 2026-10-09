import { requirePageTenant } from "@/lib/tenant";
import { listClients } from "@/services/clients";
import { ClientEditor } from "@/components/forms/client-editor";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import {
  cfdiUseCatalog,
  fiscalRegimeCatalog,
  paymentFormCatalog,
} from "@/lib/sat-catalogs";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  await requirePageTenant();
  const p = await searchParams,
    clients = await listClients(p.q, p.archived === "true");
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Catálogo"
        title="Clientes"
        copy="Receptores de facturas de tu empresa. Archivar conserva los documentos y el historial."
      />
      <form className="flex flex-wrap items-center gap-3">
        <input
          className="input !w-auto max-w-full"
          name="q"
          aria-label="Buscar clientes"
          defaultValue={p.q}
          placeholder="Nombre o RFC"
          maxLength={100}
        />
        <label className="text-sm">
          <input
            type="checkbox"
            name="archived"
            value="true"
            defaultChecked={p.archived === "true"}
          />{" "}
          Incluir archivados
        </label>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>
      <ClientEditor
        clients={JSON.parse(JSON.stringify(clients))}
        catalogs={{
          fiscalRegimes: fiscalRegimeCatalog,
          cfdiUses: cfdiUseCatalog,
          paymentForms: paymentFormCatalog,
        }}
      />
      {clients.length === 500 && (
        <p className="text-sm text-zinc-400">
          Mostrando 500 resultados. Refina la búsqueda.
        </p>
      )}
    </div>
  );
}
