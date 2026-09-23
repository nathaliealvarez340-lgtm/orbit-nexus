import {
  ArrowUpRight,
  Wallet,
  CalendarDays,
  ReceiptText,
  Clock,
  FileCheck2,
  Files,
} from "lucide-react";
import { ChartPanels } from "@/components/dashboard/chart-panels";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { TicketTable } from "@/components/dashboard/ticket-table";
import { Button } from "@/components/ui/button";
import { dashboardData } from "@/services/dashboard";
import { requirePageTenant } from "@/lib/tenant";
import { money, activityLabels } from "@/lib/display";
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const tenant = await requirePageTenant();
  const params = await searchParams;
  const n = Number(params.year);
  const year =
    Number.isInteger(n) && n >= 2000 && n <= 2100
      ? n
      : new Date().getFullYear();
  const data = await dashboardData(year);
  const kpis = [
    {
      label: "Gasto total del mes",
      value: money(data.monthTotal),
      delta: "Mes actual · MXN",
      icon: Wallet,
      tone: "purple",
    },
    {
      label: "Gasto total del año",
      value: money(data.yearTotal),
      delta: String(year) + " · MXN",
      icon: CalendarDays,
      tone: "purple",
    },
    {
      label: "Tickets capturados",
      value: String(data.ticketCount),
      delta: "Histórico de la organización",
      icon: ReceiptText,
      tone: "purple",
    },
    {
      label: "Pendientes de facturar",
      value: String(data.pending),
      delta: "Tickets sin factura incorporada",
      icon: Clock,
      tone: "amber",
    },
    {
      label: "Tickets facturados",
      value: String(data.invoiced),
      delta: "Con factura incorporada",
      icon: FileCheck2,
      tone: "green",
    },
    {
      label: "Facturas obtenidas",
      value: String(data.invoiceCount),
      delta: "Documentos registrados",
      icon: Files,
      tone: "green",
    },
  ];
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={tenant.organization.name}
        title="Panorama fiscal"
        copy="Todo lo importante de tu operación, listo para actuar."
        action={
          <Button href="/dashboard/tickets/new">
            Nuevo ticket <ArrowUpRight className="size-4" />
          </Button>
        }
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </section>
      <ChartPanels data={data.bars} year={year} />
      <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="surface min-w-0 overflow-hidden">
          <div className="flex items-center justify-between p-5">
            <p className="text-sm font-medium">Tickets recientes</p>
            <Button href="/dashboard/tickets" variant="ghost">
              Ver todos
            </Button>
          </div>
          <TicketTable tickets={data.recent} />
        </div>
        <div className="surface p-5">
          <p className="text-sm font-medium">Actividad reciente</p>
          <div className="mt-5 space-y-5">
            {data.activity.map((a) => (
              <div key={a.id} className="border-l border-violet-500/30 pl-4">
                <p className="text-sm">
                  {activityLabels[a.action] || "Actividad registrada"}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  {a.createdAt.toLocaleString("es-MX", {
                    timeZone: "America/Mexico_City",
                  })}
                </p>
              </div>
            ))}
            {!data.activity.length && (
              <p className="text-sm text-zinc-500">
                Aquí aparecerá la actividad de tu organización.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
