import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { companies } from "@/data/mock/companies";

export default function CompaniesPage() {
  return <div className="space-y-7"><PageHeader eyebrow="Cobertura" title="Empresas compatibles" copy="Reglas, portales y campos requeridos preparados para automatización futura." /><section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{companies.map((company) => <article key={company.id} className="surface p-5"><div className="flex items-start justify-between"><span className="grid size-11 place-items-center rounded-xl bg-white/[.05] font-semibold text-violet-300">{company.name.slice(0,2).toUpperCase()}</span><StatusBadge>{company.compatibility}</StatusBadge></div><h2 className="mt-6 font-medium">{company.name}</h2><p className="mt-2 text-xs leading-5 text-zinc-500">{company.rule}</p><div className="mt-5 border-t border-white/[.06] pt-4 text-xs text-zinc-600">{company.requiredFields.join(" · ")}</div><a href={company.portalUrl} target="_blank" className="mt-4 flex items-center gap-2 text-xs text-zinc-400 hover:text-white">Ver portal <ExternalLink className="size-3" /></a></article>)}</section></div>;
}

