import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  delta,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <article className="surface group p-5 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <span
          className={cn(
            "grid size-9 place-items-center rounded-xl",
            tone === "green"
              ? "bg-emerald-500/10 text-emerald-400"
              : tone === "amber"
                ? "bg-amber-500/10 text-amber-400"
                : "bg-violet-500/10 text-violet-400",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-5 font-mono text-2xl font-medium tracking-[-.05em]">
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-600">{delta}</p>
    </article>
  );
}
