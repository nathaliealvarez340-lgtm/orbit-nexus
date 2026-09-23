import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { TicketTable } from "@/components/dashboard/ticket-table";
import { Button } from "@/components/ui/button";
import { listTickets } from "@/services/tickets";
import { requirePageTenant } from "@/lib/tenant";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requirePageTenant();
  const p = await searchParams;
  const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)));
  const data = await listTickets(p.q, page);
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Comprobantes"
        title="Historial de tickets"
        copy="De la captura a la factura, cada paso a la vista."
        action={<Button href="/dashboard/tickets/new">Nuevo ticket</Button>}
      />
      <form className="flex max-w-lg gap-3">
        <input
          aria-label="Buscar tickets por comercio o archivo"
          name="q"
          className="input"
          defaultValue={p.q}
          placeholder="Buscar comercio o archivo"
          maxLength={100}
        />
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>
      <div className="surface overflow-hidden">
        <TicketTable tickets={data.tickets} />
      </div>
      <div className="flex items-center gap-5 text-sm text-zinc-400">
        <span>
          {data.count} tickets · Página {page}
        </span>
        {page > 1 && (
          <Link
            href={"?q=" + encodeURIComponent(p.q || "") + "&page=" + (page - 1)}
          >
            Anterior
          </Link>
        )}
        {page * 25 < data.count && (
          <Link
            href={"?q=" + encodeURIComponent(p.q || "") + "&page=" + (page + 1)}
          >
            Siguiente
          </Link>
        )}
      </div>
    </div>
  );
}
