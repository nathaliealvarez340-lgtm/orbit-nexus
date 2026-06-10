"use client";

import dynamic from "next/dynamic";

const SpendChart = dynamic(() => import("./charts").then((mod) => mod.SpendChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});
const CategoryChart = dynamic(() => import("./charts").then((mod) => mod.CategoryChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

function ChartSkeleton() {
  return <div className="mt-5 h-64 animate-pulse rounded-xl bg-white/[.025]" />;
}

export function ChartPanels() {
  return (
    <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
      <div className="surface p-5">
        <p className="text-sm font-medium">Gasto y facturación</p>
        <p className="mt-1 text-xs text-zinc-600">Comparativo mensual en MXN</p>
        <div className="mt-5"><SpendChart /></div>
      </div>
      <div className="surface p-5">
        <p className="text-sm font-medium">Gasto por categoría</p>
        <p className="mt-1 text-xs text-zinc-600">Distribución del periodo actual</p>
        <CategoryChart />
      </div>
    </section>
  );
}
