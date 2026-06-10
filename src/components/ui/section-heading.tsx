export function SectionHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[.2em] text-violet-400">{eyebrow}</p>
      <h2 className="text-balance text-3xl font-semibold tracking-[-.045em] text-white md:text-5xl">{title}</h2>
      <p className="mt-5 text-balance leading-7 text-zinc-400">{copy}</p>
    </div>
  );
}

