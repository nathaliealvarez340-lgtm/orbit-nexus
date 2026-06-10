import { Plus, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { TicketTable } from "@/components/dashboard/ticket-table";
import { Button } from "@/components/ui/button";

export default function TicketsPage() {
  return <div className="space-y-7"><PageHeader eyebrow="Comprobantes" title="Tickets" copy="Sigue cada comprobante desde la captura hasta su factura." action={<Button href="/dashboard/tickets/new"><Plus className="size-4" /> Nuevo ticket</Button>} /><div className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-white/[.06] p-5"><input className="input max-w-sm" placeholder="Buscar empresa o folio..." /><Button variant="secondary"><SlidersHorizontal className="size-4" /> Filtros</Button></div><TicketTable /></div></div>;
}

