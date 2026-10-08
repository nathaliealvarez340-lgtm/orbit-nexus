import Link from "next/link";
import { requirePageTenant } from "@/lib/tenant";
import { tenantPlan } from "@/services/plans";
import { outgoingContext } from "@/services/outgoing-invoices";
import { PlanLock } from "@/components/dashboard/plan-lock";
import { PageHeader } from "@/components/dashboard/page-header";
import { OutgoingInvoiceForm } from "@/components/forms/outgoing-invoice-form";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  await requirePageTenant();
  if ((await tenantPlan()).plan === "FREE") return <PlanLock />;
  const [{ drafts }, params] = await Promise.all([
    outgoingContext(),
    searchParams,
  ]);
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Facturación a clientes"
        title="Invoice Studio"
        copy="Prepara tu factura, revisa cada dato y conserva tu borrador. El timbrado aún no está configurado."
      />
      <OutgoingInvoiceForm key={params.draft ?? "new"} draftId={params.draft} />
      <section className="surface p-5" aria-labelledby="recent-drafts-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="recent-drafts-title" className="font-medium">
            Borradores recientes
          </h2>
          <Link
            className="text-sm text-violet-300 underline"
            href="/dashboard/invoices/issued"
          >
            CFDI emitidos
          </Link>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {drafts.map((draft) => (
            <li
              key={draft.id}
              className="min-w-0 rounded-xl border border-white/10 p-4"
            >
              <Link
                className="text-sm text-violet-300 underline"
                href={"?draft=" + encodeURIComponent(draft.id)}
              >
                {draft.folio ?? "Borrador"} · {draft.receiverRfc}
              </Link>
              <p className="mt-2 font-mono text-sm text-zinc-400">
                {draft.total.toFixed(2)} {draft.currency}
              </p>
            </li>
          ))}
        </ul>
        {!drafts.length && (
          <p className="mt-3 text-sm text-zinc-400">
            Tus borradores aparecerán aquí después de guardarlos.
          </p>
        )}
      </section>
    </div>
  );
}
