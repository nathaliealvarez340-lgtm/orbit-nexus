import { Bell, ChevronDown, Search } from "lucide-react";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[.06] bg-[#0c0c0f]/85 px-5 backdrop-blur-xl md:px-8">
      <div className="flex items-center gap-2 text-sm text-zinc-500"><Search className="size-4" /> Buscar tickets, facturas o empresas...</div>
      <div className="flex items-center gap-3">
        <button className="grid size-9 place-items-center rounded-xl border border-white/[.08] text-zinc-400"><Bell className="size-4" /></button>
        <button className="flex items-center gap-2 rounded-xl border border-white/[.08] p-1.5 pr-3 text-sm">
          <span className="grid size-7 place-items-center rounded-lg bg-violet-500/20 text-xs font-semibold text-violet-300">NG</span>
          <span className="hidden sm:inline">Nathalie</span><ChevronDown className="size-3 text-zinc-500" />
        </button>
      </div>
    </header>
  );
}

