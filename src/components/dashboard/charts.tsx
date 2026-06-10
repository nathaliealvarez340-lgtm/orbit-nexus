"use client";

import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { categorySpend, monthlySpend } from "@/data/mock/dashboard";

const tooltipStyle = { background: "#18181b", border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, fontSize: 12 };

export function SpendChart() {
  return (
    <div className="h-64 min-w-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={monthlySpend}>
          <defs><linearGradient id="orbitFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={.35}/><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke="rgba(255,255,255,.04)" vertical={false} />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#71717a", fontSize: 11 }} />
          <YAxis hide />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="gastos" stroke="#8b5cf6" fill="url(#orbitFill)" strokeWidth={2} />
          <Area type="monotone" dataKey="facturado" stroke="#34d399" fill="transparent" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart() {
  return (
    <div className="flex h-64 min-w-0 items-center">
      <ResponsiveContainer width="60%" height="100%" minWidth={0}>
        <PieChart><Pie data={categorySpend} innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value">{categorySpend.map((item) => <Cell key={item.name} fill={item.fill} />)}</Pie><Tooltip contentStyle={tooltipStyle} /></PieChart>
      </ResponsiveContainer>
      <div className="space-y-3">{categorySpend.map((item) => <div key={item.name} className="flex items-center gap-2 text-xs text-zinc-400"><span className="size-2 rounded-full" style={{ background: item.fill }} />{item.name}<span className="font-mono text-zinc-600">{item.value}%</span></div>)}</div>
    </div>
  );
}
