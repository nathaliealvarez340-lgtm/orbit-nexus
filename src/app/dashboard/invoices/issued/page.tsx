import { requirePageTenant } from "@/lib/tenant";
import { tenantPlan } from "@/services/plans";
import { issuedInvoices } from "@/services/outgoing-invoices";
import { PlanLock } from "@/components/dashboard/plan-lock";
import { PageHeader } from "@/components/dashboard/page-header";
export default async function Page() {
  await requirePageTenant();
  if ((await tenantPlan()).plan === "FREE") return <PlanLock />;
  const invoices = await issuedInvoices();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Facturación a clientes"
        title="CFDI emitidos"
        copy="Únicamente comprobantes emitidos con UUID y fecha de emisión. Los borradores no aparecen aquí."
      />
      <div
        className="surface overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Tabla de CFDI emitidos"
      >
        <table className="w-full">
          <thead>
            <tr>
              {[
                "Folio",
                "UUID",
                "Cliente",
                "RFC",
                "Fecha",
                "Subtotal",
                "Impuestos",
                "Total",
                "Estado",
                "Archivos",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>{i.folio}</td>
                <td>{i.uuid}</td>
                <td>
                  {String(
                    (i.receiverSnapshot as Record<string, unknown> | null)
                      ?.legalName ?? "—",
                  )}
                </td>
                <td>{i.receiverRfc}</td>
                <td>{i.issuedAt?.toLocaleDateString("es-MX")}</td>
                <td>{i.subtotal.toFixed(2)}</td>
                <td>{i.tax.toFixed(2)}</td>
                <td>
                  {i.total.toFixed(2)} {i.currency}
                </td>
                <td>Emitido</td>
                <td>
                  {i.xmlDocumentId && (
                    <a
                      className="mr-3 underline"
                      href={"/api/documents/" + i.xmlDocumentId}
                    >
                      XML
                    </a>
                  )}
                  {i.pdfDocumentId && (
                    <a
                      className="underline"
                      href={"/api/documents/" + i.pdfDocumentId}
                    >
                      PDF
                    </a>
                  )}
                  {!i.xmlDocumentId && !i.pdfDocumentId && "Sin archivos"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!invoices.length && (
          <p className="p-6 text-sm text-zinc-400">
            Sin CFDI emitidos. El PAC no está conectado; preparar un borrador no
            emite una factura.
          </p>
        )}
      </div>
    </div>
  );
}
