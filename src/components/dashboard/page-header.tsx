import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-violet-400">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] md:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{copy}</p>
      </div>
      {action}
    </div>
  );
}

