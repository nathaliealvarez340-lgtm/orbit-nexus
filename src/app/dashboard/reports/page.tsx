import { monthlyReports } from "@/services/reports";
import { requirePageTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/dashboard/page-header";
import { money } from "@/lib/display";
export default async function Page() {
  await requirePageTenant();
  const reports = await monthlyReports();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Gastos"
        title="Reportes mensuales"
        copy="Historial de meses cerrados. Los importes y tickets del cierre se conservan."
      />
      <p className="text-sm text-zinc-400">
        PDF y Excel incluyen resumen y detalle de gastos confirmados en MXN. Un
        gasto registrado después de generar el cierre no altera el reporte
        histórico. Los cierres nuevos muestran también los CFDI vinculados
        posteriormente a sus tickets. Los cierres antiguos sin vínculos conservan
        la información original.
      </p>
      <div
        className="surface overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Tabla de reportes mensuales"
      >
        <table className="w-full">
          <thead>
            <tr>
              {[
                "Periodo",
                "Gasto total",
                "Tickets registrados",
                "Facturas obtenidas",
                "Pendientes",
                "Generado",
                "Descargas",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.year}-{String(r.month).padStart(2, "0")}
                </td>
                <td>{money(Number(r.total))}</td>
                <td>{r.ticketCount}</td>
                <td>{r.invoiceCount}</td>
                <td>{r.pendingCount}</td>
                <td className="whitespace-nowrap">
                  {r.createdAt.toLocaleDateString("es-MX", {
                    timeZone: "America/Mexico_City",
                  })}
                </td>
                <td>
                  <div className="flex gap-4">
                    <a
                      className="text-violet-300 underline"
                      href={"/api/reports/" + r.id + "?format=pdf"}
                    >
                      PDF
                    </a>
                    <a
                      className="text-violet-300 underline"
                      href={"/api/reports/" + r.id + "?format=xlsx"}
                    >
                      Excel
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!reports.length && (
          <p className="p-6 text-sm text-zinc-400">
            Tu empresa todavía no tiene meses cerrados. Aquí aparecerá el primer
            reporte al terminar el mes.
          </p>
        )}
      </div>
    </div>
  );
}
