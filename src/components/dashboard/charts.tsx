"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "@/lib/display";
export function SpendChart({
  data,
}: {
  data: { month: string; total: number }[];
}) {
  return (
    <div
      className="h-72 min-w-0"
      role="img"
      aria-label="Gastos confirmados por mes en pesos mexicanos"
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart
          data={data}
          margin={{ top: 12, right: 8, left: 0, bottom: 4 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
            tick={{ fill: "#a1a1aa", fontSize: 10 }}
          />
          <YAxis
            width={58}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#71717a", fontSize: 10 }}
            tickFormatter={(v) =>
              Number(v) >= 1000 ? Number(v) / 1000 + "k" : String(v)
            }
          />
          <Tooltip
            cursor={{ fill: "rgba(139,92,246,.05)" }}
            contentStyle={{
              background: "#18181b",
              border: "1px solid #333",
              borderRadius: 12,
            }}
            formatter={(value) => [money(Number(value)), "Gasto"]}
          />
          <Bar
            dataKey="total"
            fill="#8b5cf6"
            radius={[5, 5, 0, 0]}
            maxBarSize={42}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
