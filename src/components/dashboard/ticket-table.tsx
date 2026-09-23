import Link from "next/link";
import { money, ticketStatuses, billingStatuses } from "@/lib/display";
type Row = {
  id: string;
  fileName: string;
  merchant: string | null;
  status: string;
  billingStatus: string;
  createdAt: Date;
  user: { name: string };
  expense: {
    merchant: string;
    purchaseDate: Date;
    total: { toString(): string };
  } | null;
};
export function TicketTable({
  tickets,
  limit,
}: {
  tickets: Row[];
  limit?: number;
}) {
  if (!tickets.length)
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-zinc-400">
          Tu historial comienza con el primer ticket.
        </p>
        <Link
          href="/dashboard/tickets/new"
          className="mt-3 inline-block text-sm text-violet-300"
        >
          Capturar ticket →
        </Link>
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-left text-sm">
        <thead>
          <tr className="border-b border-white/[.06] text-xs text-zinc-500">
            {[
              "Comercio",
              "Fecha",
              "Total",
              "Capturado por",
              "Lectura OCR",
              "Facturación",
              "Acción",
            ].map((h) => (
              <th key={h} className="px-5 py-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickets.slice(0, limit).map((t) => (
            <tr
              key={t.id}
              className="border-b border-white/[.04] last:border-0 hover:bg-white/[.02]"
            >
              <td className="max-w-52 truncate px-5 py-4 font-medium">
                {t.expense?.merchant || t.merchant || t.fileName}
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-zinc-400">
                {t.expense?.purchaseDate.toISOString().slice(0, 10) ||
                  "Por confirmar"}
              </td>
              <td className="whitespace-nowrap px-5 py-4 font-mono">
                {t.expense ? money(t.expense.total.toString()) : "—"}
              </td>
              <td className="px-5 py-4 text-zinc-400">{t.user.name}</td>
              <td className="px-5 py-4 text-xs text-violet-300">
                {ticketStatuses[t.status] || t.status}
              </td>
              <td className="px-5 py-4 text-xs text-zinc-400">
                {billingStatuses[t.billingStatus]}
              </td>
              <td className="px-5 py-4">
                <Link
                  href={"/dashboard/tickets/" + t.id}
                  className="text-violet-300"
                >
                  Abrir
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
