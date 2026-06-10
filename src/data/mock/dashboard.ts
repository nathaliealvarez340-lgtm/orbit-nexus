import { Banknote, FileCheck2, FileClock, Receipt, Stamp, TrendingUp } from "lucide-react";

export const kpis = [
  { label: "Total gastado", value: "$186,420", delta: "+12.4%", icon: Banknote, tone: "purple" },
  { label: "Total facturado", value: "$142,890", delta: "76.6%", icon: FileCheck2, tone: "green" },
  { label: "Facturas emitidas", value: "128", delta: "+18 este mes", icon: Receipt, tone: "purple" },
  { label: "Facturas timbradas", value: "96", delta: "PAC preparado", icon: Stamp, tone: "green" },
  { label: "Tickets pendientes", value: "14", delta: "3 requieren acción", icon: FileClock, tone: "amber" },
  { label: "Ahorro estimado", value: "42 h", delta: "+9.2% vs mayo", icon: TrendingUp, tone: "purple" },
];

export const monthlySpend = [
  { month: "Ene", gastos: 18000, facturado: 14200 },
  { month: "Feb", gastos: 23500, facturado: 19800 },
  { month: "Mar", gastos: 21400, facturado: 18200 },
  { month: "Abr", gastos: 29600, facturado: 25100 },
  { month: "May", gastos: 34800, facturado: 28000 },
  { month: "Jun", gastos: 38300, facturado: 32100 },
];

export const categorySpend = [
  { name: "Operación", value: 42, fill: "#8b5cf6" },
  { name: "Viáticos", value: 25, fill: "#a78bfa" },
  { name: "Insumos", value: 19, fill: "#34d399" },
  { name: "Otros", value: 14, fill: "#3f3f46" },
];

export const activity = [
  { title: "Ticket de Costco procesado", detail: "OCR detectó 8 campos · 98% confianza", time: "Hace 4 min" },
  { title: "Factura Walmart lista", detail: "XML y PDF almacenados", time: "Hace 26 min" },
  { title: "Perfil fiscal actualizado", detail: "Se confirmó el régimen fiscal", time: "Ayer, 18:42" },
  { title: "CFDI timbrado en modo prueba", detail: "Folio ORB-0096", time: "Ayer, 12:10" },
];

