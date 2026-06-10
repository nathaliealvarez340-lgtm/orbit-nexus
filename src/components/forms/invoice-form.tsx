"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { currency } from "@/lib/utils";

export function InvoiceForm() {
  const [concepts, setConcepts] = useState([{ description: "Servicios profesionales", quantity: 1, price: 10000 }]);
  const subtotal = useMemo(() => concepts.reduce((sum, item) => sum + item.quantity * item.price, 0), [concepts]);
  const iva = subtotal * .16;
  return <div className="grid gap-5 xl:grid-cols-[1.5fr_.7fr]"><div className="surface p-6"><div className="grid gap-4 md:grid-cols-2"><label className="text-sm text-zinc-400">RFC receptor<input className="input mt-2" placeholder="XAXX010101000" /></label><label className="text-sm text-zinc-400">Razón social<input className="input mt-2" placeholder="Cliente de ejemplo" /></label></div><div className="mt-7 flex items-center justify-between"><p className="text-sm font-medium">Conceptos</p><Button variant="secondary" className="h-9" ><Plus className="size-4" /> Agregar</Button></div><div className="mt-3 space-y-3">{concepts.map((concept, index) => <div key={index} className="grid gap-3 rounded-2xl border border-white/[.07] p-4 md:grid-cols-[1fr_90px_130px_36px]"><input className="input" value={concept.description} onChange={(e) => setConcepts(concepts.map((c,i) => i === index ? {...c, description: e.target.value} : c))} /><input className="input" type="number" value={concept.quantity} onChange={(e) => setConcepts(concepts.map((c,i) => i === index ? {...c, quantity: Number(e.target.value)} : c))} /><input className="input" type="number" value={concept.price} onChange={(e) => setConcepts(concepts.map((c,i) => i === index ? {...c, price: Number(e.target.value)} : c))} /><button onClick={() => setConcepts(concepts.filter((_,i) => i !== index))} className="text-zinc-600 hover:text-red-400"><Trash2 className="size-4" /></button></div>)}</div></div><aside className="surface h-fit p-6"><p className="text-sm font-medium">Vista previa</p><div className="mt-6 space-y-3 border-b border-white/[.07] pb-5 text-sm"><div className="flex justify-between text-zinc-500"><span>Subtotal</span><span className="font-mono text-white">{currency(subtotal)}</span></div><div className="flex justify-between text-zinc-500"><span>IVA 16%</span><span className="font-mono text-white">{currency(iva)}</span></div></div><div className="flex justify-between py-5"><span>Total</span><span className="font-mono text-xl">{currency(subtotal + iva)}</span></div><div className="rounded-xl border border-amber-500/20 bg-amber-500/[.07] p-3 text-xs leading-5 text-amber-300">Pendiente de integración PAC. No se emitirá un CFDI real.</div><Button className="mt-4 w-full">Generar vista previa</Button></aside></div>;
}

