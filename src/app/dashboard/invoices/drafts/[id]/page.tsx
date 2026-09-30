import { notFound } from "next/navigation";
import Image from "next/image";
import { requirePageTenant } from "@/lib/tenant";
import { tenantPlan } from "@/services/plans";
import { getOutgoingInvoice } from "@/services/outgoing-invoices";
import { ApiError } from "@/lib/http";
import { PlanLock } from "@/components/dashboard/plan-lock";
import { PageHeader } from "@/components/dashboard/page-header";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageTenant();
  if ((await tenantPlan()).plan === "FREE") return <PlanLock />;
  let invoice;
  try {
    invoice = await getOutgoingInvoice((await params).id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const issuer = invoice.issuerSnapshot as Record<string, string> | null,
    receiver = invoice.receiverSnapshot as Record<string, string> | null,
    template = invoice.templateSnapshot as Record<string, string> | null;
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Vista previa · Preparación"
        title={invoice.folio ?? "Borrador"}
        copy="Timbrado pendiente de integración PAC. Este documento no tiene validez como CFDI."
      />
      <article
        className="surface p-6 md:p-9"
        style={{ borderTop: "4px solid " + (template?.color ?? "#8b5cf6") }}
      >
        <div className="flex flex-wrap items-start justify-between gap-5">
          {template?.logoDocumentId && (
            <Image
              unoptimized
              src={"/api/documents/" + template.logoDocumentId + "?preview=1"}
              alt="Logo del emisor"
              width={180}
              height={100}
              className="max-h-24 object-contain"
            />
          )}
          <div className="text-sm">
            <p>
              {invoice.folio} ·{" "}
              {invoice.status === "DRAFT" ? "BORRADOR" : invoice.status}
            </p>
            <p className="mt-2">
              {invoice.invoiceDate?.toISOString().slice(0, 10)} ·{" "}
              {invoice.currency}
            </p>
          </div>
        </div>
        <div className="my-8 grid gap-6 md:grid-cols-2">
          {[
            [issuer, "Emisor", invoice.issuerRfc],
            [receiver, "Receptor", invoice.receiverRfc],
          ].map(([raw, label, rfc]) => {
            const data = raw as Record<string, string> | null;
            return (
              <section key={String(label)} className="text-sm">
                <h2 className="mb-2 text-zinc-400">{String(label)}</h2>
                <p className="font-medium">{data?.legalName}</p>
                <p>{String(rfc)}</p>
                <p className="mt-2 text-zinc-400">
                  {[
                    data?.street,
                    data?.exteriorNumber,
                    data?.interiorNumber,
                    data?.colony,
                    data?.locality,
                    data?.municipality,
                    data?.state,
                    data?.postalCode,
                    data?.country,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="mt-2">Régimen: {data?.fiscalRegime}</p>
              </section>
            );
          })}
        </div>
        <p className="mb-5 text-sm">
          Tipo {invoice.documentType} · Uso CFDI {invoice.cfdiUse} · Forma{" "}
          {invoice.paymentForm} · Método {invoice.paymentMethod}
        </p>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Tabla de conceptos"
        >
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Concepto",
                  "Clave / unidad",
                  "Cantidad",
                  "Precio",
                  "IVA",
                  "Importe",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoice.concepts.map((c) => (
                <tr key={c.id}>
                  <td className="min-w-48">{c.description}</td>
                  <td>
                    {c.productCode} / {c.unitCode}
                  </td>
                  <td>{c.quantity.toString()}</td>
                  <td>{c.unitPrice.toFixed(2)}</td>
                  <td>{c.taxRate.mul(100).toString()}%</td>
                  <td>{c.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-6 ml-auto grid max-w-xs grid-cols-2 gap-3 text-sm">
          <dt>Subtotal</dt>
          <dd>
            {invoice.subtotal.toFixed(2)} {invoice.currency}
          </dd>
          <dt>Impuestos</dt>
          <dd>
            {invoice.tax.toFixed(2)} {invoice.currency}
          </dd>
          <dt className="font-semibold">Total</dt>
          <dd className="font-semibold">
            {invoice.total.toFixed(2)} {invoice.currency}
          </dd>
        </dl>
        <p className="mt-8 border-t border-white/10 pt-5 text-sm text-zinc-400">
          BORRADOR · Sin timbre fiscal. La emisión, validación SAT y cancelación
          requieren integraciones posteriores.
        </p>
      </article>
    </div>
  );
}
