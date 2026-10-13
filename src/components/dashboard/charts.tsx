"use client";
import { useExperience } from "@/components/experience/experience-provider";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
export function SpendChart({
  data,
  issued = false,
  currency = "MXN",
}: {
  data: { month: string; total: number }[];
  issued?: boolean;
  currency?: string;
}) {
  const { value } = useExperience();
  return (
    <div
      className="h-72 min-w-0"
      role="img"
      aria-label={
        issued
          ? "Facturación emitida por mes en " + currency
          : "Gastos confirmados por mes en pesos mexicanos"
      }
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart
          data={data}
          margin={{ top: 12, right: 8, left: 0, bottom: 4 }}
        >
          <CartesianGrid stroke="rgb(var(--orbit-line-rgb)/.1)" vertical={false} />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
            tick={{ fill: "var(--orbit-muted)", fontSize: 10 }}
          />
          <YAxis
            width={58}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--orbit-muted)", fontSize: 10 }}
            tickFormatter={(v) =>
              Number(v) >= 1000 ? Number(v) / 1000 + "k" : String(v)
            }
          />
          <Tooltip
            cursor={{ fill: "rgba(139,92,246,.05)" }}
            contentStyle={{
              background: "var(--orbit-elevated)", color: "var(--orbit-text)",
              border: "1px solid rgb(var(--orbit-line-rgb)/.2)",
              borderRadius: 12,
            }}
            formatter={(amount) => [
              new Intl.NumberFormat(value.locale, {
                style: "currency",
                currency,
              }).format(Number(amount)),
              issued ? "Facturación" : "Gasto",
            ]}
          />
          <Bar
            dataKey="total"
            fill="var(--orbit-accent, #8b5cf6)"
            radius={[5, 5, 0, 0]}
            maxBarSize={42}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
