import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { requirePageTenant } from "@/lib/tenant";
import { getDb } from "@/lib/db";
import { money } from "@/lib/display";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { organizationId } = await requirePageTenant();
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(100000, Math.floor(Number(params.page) || 1)),
  );
  const [invoices, count] = await Promise.all([
    getDb().invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 25,
      skip: (page - 1) * 25,
    }),
    getDb().invoice.count({ where: { organizationId } }),
  ]);
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Archivo fiscal"
        title="Historial de facturas"
        copy="CFDI incorporados a tu organización. La autenticidad y vigencia ante el SAT están pendientes de verificación externa."
      />
      <div className="surface overflow-x-auto">
        {!invoices.length ? (
          <div className="p-12 text-center">
            <p className="text-sm text-zinc-400">
              Todavía no hay facturas incorporadas.
            </p>
            <Link
              className="mt-3 inline-block text-sm text-violet-300"
              href="/dashboard/tickets"
            >
              Preparar la facturación de un ticket →
            </Link>
          </div>
        ) : (
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-zinc-500">
                {[
                  "Emisor",
                  "Fecha",
                  "Total",
                  "UUID",
                  "Documentos",
                  "Estado",
                  "Ticket",
                ].map((h) => (
                  <th key={h} className="p-4 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b border-white/5">
                  <td className="p-4">
                    {i.issuerName || "Emisor no informado"}
                  </td>
                  <td className="p-4">
                    {(i.issuedAt || i.createdAt).toISOString().slice(0, 10)}
                  </td>
                  <td className="p-4 font-mono">{money(i.total.toString())}</td>
                  <td className="p-4 font-mono text-xs">{i.uuid || "—"}</td>
                  <td className="p-4">
                    <div className="flex gap-3 text-violet-300">
                      {i.xmlDocumentId && (
                        <a href={"/api/documents/" + i.xmlDocumentId}>XML</a>
                      )}
                      {i.pdfDocumentId && (
                        <a href={"/api/documents/" + i.pdfDocumentId}>PDF</a>
                      )}
                      {!i.xmlDocumentId && !i.pdfDocumentId && "—"}
                    </div>
                  </td>
                  <td className="p-4 text-xs">
                    {i.status === "ISSUED" ? "CFDI incorporado" : i.status}
                  </td>
                  <td className="p-4">
                    {i.ticketId && (
                      <Link
                        href={"/dashboard/tickets/" + i.ticketId}
                        className="text-violet-300"
                      >
                        Ver ticket
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex gap-5 text-sm text-zinc-400">
        <span>
          {count} facturas · Página {page}
        </span>
        {page > 1 && <Link href={"?page=" + (page - 1)}>Anterior</Link>}
        {page * 25 < count && (
          <Link href={"?page=" + (page + 1)}>Siguiente</Link>
        )}
      </div>
    </div>
  );
}
