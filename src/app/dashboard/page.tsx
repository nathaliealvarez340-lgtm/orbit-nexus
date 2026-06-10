import { ArrowUpRight } from "lucide-react";
import { ChartPanels } from "@/components/dashboard/chart-panels";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { TicketTable } from "@/components/dashboard/ticket-table";
import { Button } from "@/components/ui/button";
import { activity, kpis } from "@/data/mock/dashboard";

export default function DashboardPage() {
  return <div className="space-y-7"><PageHeader eyebrow="Martes, 9 de junio" title="Panorama fiscal" copy="Todo lo importante de tu operación, listo para actuar." action={<Button href="/dashboard/tickets/new">Nuevo ticket <ArrowUpRight className="size-4" /></Button>} /><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}</section><ChartPanels /><section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]"><div className="surface overflow-hidden"><div className="flex items-center justify-between p-5"><div><p className="text-sm font-medium">Tickets recientes</p><p className="mt-1 text-xs text-zinc-600">Actividad operativa más reciente</p></div><Button href="/dashboard/tickets" variant="ghost">Ver todos</Button></div><TicketTable limit={4} /></div><div className="surface p-5"><p className="text-sm font-medium">Actividad</p><div className="mt-5 space-y-5">{activity.map((item) => <div key={item.title} className="border-l border-white/10 pl-4"><p className="text-sm">{item.title}</p><p className="mt-1 text-xs text-zinc-600">{item.detail}</p><p className="mt-2 font-mono text-[10px] text-zinc-700">{item.time}</p></div>)}</div></div></section></div>;
}
