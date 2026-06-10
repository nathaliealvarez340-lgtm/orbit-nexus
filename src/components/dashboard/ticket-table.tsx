import { MoreHorizontal } from "lucide-react";
import { tickets } from "@/data/mock/tickets";
import { currency } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";

export function TicketTable({ limit }: { limit?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead><tr className="border-b border-white/[.06] text-xs uppercase tracking-wider text-zinc-600"><th className="px-5 py-4 font-medium">Ticket</th><th className="px-5 py-4 font-medium">Empresa</th><th className="px-5 py-4 font-medium">Fecha</th><th className="px-5 py-4 font-medium">Total</th><th className="px-5 py-4 font-medium">Estado</th><th /></tr></thead>
        <tbody>{tickets.slice(0, limit).map((ticket) => <tr key={ticket.id} className="border-b border-white/[.04] last:border-0 hover:bg-white/[.02]">
          <td className="px-5 py-4 font-mono text-xs text-zinc-500">{ticket.id}</td><td className="px-5 py-4 font-medium">{ticket.company}</td><td className="px-5 py-4 text-zinc-500">{ticket.date}</td><td className="px-5 py-4 font-mono">{currency(ticket.total)}</td><td className="px-5 py-4"><StatusBadge>{ticket.status}</StatusBadge></td><td className="px-5 py-4 text-zinc-600"><MoreHorizontal className="size-4" /></td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

