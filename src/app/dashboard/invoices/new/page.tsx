import Link from "next/link";
import { requirePageTenant } from "@/lib/tenant";
import { tenantPlan } from "@/services/plans";
import { outgoingContext } from "@/services/outgoing-invoices";
import { fiscalProfileComplete } from "@/lib/fiscal-catalogs";
import { PlanLock } from "@/components/dashboard/plan-lock";
import { PageHeader } from "@/components/dashboard/page-header";
import { OutgoingInvoiceForm } from "@/components/forms/outgoing-invoice-form";
export default async function Page() {
  await requirePageTenant();
  if ((await tenantPlan()).plan === "FREE") return <PlanLock />;
  const data = await outgoingContext(),
    ready =
      fiscalProfileComplete(data.profile) && !!data.settings?.logoDocumentId;
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Facturación · Borradores"
        title="Nueva factura"
        copy="Prepara los datos y revisa el documento. Timbrado pendiente de integración PAC."
      />
      <div className="surface space-y-3 p-5 text-sm">
        <p>
          Emisor: {data.profile?.legalName ?? "Sin perfil fiscal"} ·{" "}
          {data.profile?.rfc ?? "RFC pendiente"}
        </p>
        <p>
          Serie: {data.settings?.prefix ?? "ORB"} · Folio asignado al guardar
        </p>
        <div className="flex flex-wrap gap-5">
          <Link
            className="text-violet-300 underline"
            href="/dashboard/fiscal-profile"
          >
            Perfil fiscal{" "}
            {fiscalProfileComplete(data.profile) ? "completo" : "pendiente"}
          </Link>
          <Link
            className="text-violet-300 underline"
            href="/dashboard/invoices/settings"
          >
            Configurar facturas
          </Link>
          <Link className="text-violet-300 underline" href="/dashboard/clients">
            Administrar clientes
          </Link>
        </div>
        {!ready && (
          <p>
            Completa el perfil fiscal con constancia y configura el logo para
            continuar.
          </p>
        )}
      </div>
      <OutgoingInvoiceForm
        clients={data.clients.map((c) => ({
          id: c.id,
          legalName: c.legalName,
          rfc: c.rfc,
          cfdiUse: c.cfdiUse,
          defaultPaymentForm: c.defaultPaymentForm,
        }))}
        ready={ready}
      />
      <section className="surface p-5">
        <h2 className="font-medium">Borradores recientes</h2>
        <ul className="mt-4 space-y-3">
          {data.drafts.map((d) => (
            <li key={d.id}>
              <Link
                className="text-sm text-violet-300 underline"
                href={"/dashboard/invoices/drafts/" + d.id}
              >
                {d.folio ?? "Borrador"} · {d.receiverRfc} · {d.total.toFixed(2)}{" "}
                {d.currency}
              </Link>
            </li>
          ))}
        </ul>
        {!data.drafts.length && (
          <p className="mt-3 text-sm text-zinc-400">Aún no hay borradores.</p>
        )}
      </section>
    </div>
  );
}
