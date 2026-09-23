import { InvoiceImport } from "@/components/forms/invoice-import";
import Image from "next/image";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTicket } from "@/services/tickets";
import { requirePageTenant } from "@/lib/tenant";
import { ApiError } from "@/lib/http";
import { PageHeader } from "@/components/dashboard/page-header";
import { TicketReview } from "@/components/forms/ticket-review";
import { AssistedInvoice } from "@/components/forms/assisted-invoice";
import { money, ticketStatuses, billingStatuses } from "@/lib/display";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageTenant();
  const ticket = await getTicket((await params).id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const fields = Object.fromEntries(
    Object.entries(ticket.extractedData?.fields || {}).filter(
      ([, v]) => typeof v === "string",
    ),
  ) as Record<string, string>;
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={ticketStatuses[ticket.status]}
        title={
          ticket.expense?.merchant || ticket.merchant || "Revisa tu ticket"
        }
        copy={"Capturado por " + ticket.user.name + " · " + ticket.fileName}
      />
      <ol className="flex flex-wrap gap-3 text-xs text-zinc-400">
        {[
          "Capturado",
          "Analizando",
          "Datos detectados",
          "Revisión",
          "Confirmado",
          "Registrado",
        ].map((step, i) => (
          <li
            key={step}
            className="rounded-lg border border-white/10 px-3 py-2"
          >
            <span className="mr-2 text-violet-400">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <div className="grid items-start gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <aside className="surface p-5">
          {ticket.documentId && ticket.mimeType.startsWith("image/") ? (
            <Image
              unoptimized
              width={1600}
              height={1200}
              src={"/api/documents/" + ticket.documentId + "?preview=1"}
              alt="Ticket original"
              className="max-h-[600px] w-full rounded-xl object-contain"
            />
          ) : (
            <p className="py-12 text-center text-sm text-zinc-400">
              Documento PDF · Descarga el original para revisarlo.
            </p>
          )}
          {ticket.documentId && (
            <a
              href={"/api/documents/" + ticket.documentId}
              className="mt-4 inline-block text-sm text-violet-300"
            >
              Descargar original
            </a>
          )}
        </aside>
        {ticket.expense ? (
          <div className="space-y-5">
            <section className="surface p-6">
              <p className="text-sm text-emerald-400">
                Confirmado y registrado
              </p>
              <p className="mt-4 font-mono text-3xl">
                {money(ticket.expense.total.toString())}
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                {ticket.expense.purchaseDate.toISOString().slice(0, 10)} ·{" "}
                {billingStatuses[ticket.billingStatus]}
              </p>
              <Link
                href="/dashboard"
                className="mt-5 inline-block text-sm text-violet-300"
              >
                Ver dashboard actualizado →
              </Link>
            </section>
            {ticket.billingStatus !== "INVOICED" && (
              <>
                <AssistedInvoice ticketId={ticket.id} />
                <InvoiceImport ticketId={ticket.id} />
              </>
            )}
          </div>
        ) : (
          <TicketReview
            id={ticket.id}
            status={ticket.status}
            provider={ticket.extractedData?.provider}
            confidence={ticket.extractedData?.confidence}
            fields={fields}
          />
        )}
      </div>
    </div>
  );
}
