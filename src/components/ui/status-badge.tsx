import { cn } from "@/lib/utils";

export function StatusBadge({ children }: { children: React.ReactNode }) {
  const text = String(children);
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
      ["Listo", "Facturado", "Automática", "Activo"].includes(text) && "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
      ["Analizando", "Asistida"].includes(text) && "border-violet-500/20 bg-violet-500/10 text-violet-300",
      ["Pendiente", "Próximamente"].includes(text) && "border-amber-500/20 bg-amber-500/10 text-amber-300",
    )}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

