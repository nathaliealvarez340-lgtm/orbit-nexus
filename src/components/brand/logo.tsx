import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5 font-semibold tracking-[-0.03em]">
      <span className="relative grid size-8 place-items-center rounded-xl border border-violet-400/30 bg-violet-500/10">
        <span className="size-2 rounded-full bg-violet-400 shadow-[0_0_18px_5px_rgba(139,92,246,.45)]" />
        <span className="absolute inset-1 rounded-full border border-violet-400/30 transition-transform duration-200 group-hover:rotate-45" />
      </span>
      {!compact && <span>ORBIT <span className="text-zinc-500">NEXUS</span></span>}
    </Link>
  );
}

