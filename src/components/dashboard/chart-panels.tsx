"use client";
import dynamic from "next/dynamic";
import { money } from "@/lib/display";
const SpendChart = dynamic(() => import("./charts").then((m) => m.SpendChart), {
  ssr: false,
  loading: () => (
    <div className="h-72 animate-pulse rounded-xl bg-white/[.025]" />
  ),
});
export function ChartPanels({
  data,
  year,
}: {
  data: { month: string; total: number }[];
  year: number;
}) {
  const empty = data.every((d) => d.total === 0);
  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Gasto registrado por mes</p>
          <p className="mt-1 text-xs text-zinc-500">
            Enero — diciembre {year} · MXN · Solo gastos confirmados
          </p>
        </div>
        <form className="flex items-center gap-2">
          <label className="text-xs text-zinc-400" htmlFor="year">
            Año
          </label>
          <input
            id="year"
            name="year"
            type="number"
            min={2000}
            max={2100}
            defaultValue={year}
            className="input !w-24"
          />
          <button
            className="rounded-lg border border-white/10 px-3 py-2 text-xs"
            type="submit"
          >
            Aplicar
          </button>
        </form>
      </div>
      <div className="mt-5">
        <SpendChart data={data} />
      </div>
      {empty && (
        <p className="text-center text-sm text-zinc-500">
          Aún no hay gastos confirmados en este año.
        </p>
      )}
      <details className="mt-4 text-xs text-zinc-500">
        <summary className="cursor-pointer">Ver importes mensuales</summary>
        <dl className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {data.map((d) => (
            <div key={d.month}>
              <dt>{d.month}</dt>
              <dd className="mt-1 font-mono text-zinc-300">{money(d.total)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
