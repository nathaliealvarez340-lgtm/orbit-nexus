"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const fields = [
  ["RFC", "NAGL920101ABC"], ["Razón social", "Nathalie García López"], ["Régimen fiscal", "612 · Personas Físicas con Actividades Empresariales"],
  ["Código postal fiscal", "06600"], ["Uso CFDI", "G03 · Gastos en general"], ["Correo", "fiscal@orbitnexus.mx"], ["Teléfono", "+52 55 1234 5678"], ["Dirección", "Paseo de la Reforma 250, Ciudad de México"],
];

export function FiscalForm() {
  const [saved, setSaved] = useState(false);
  return <form onSubmit={(e) => { e.preventDefault(); setSaved(true); }} className="surface p-6"><div className="grid gap-5 md:grid-cols-2">{fields.map(([label,value]) => <label key={label} className={label === "Dirección" ? "md:col-span-2 text-sm text-zinc-400" : "text-sm text-zinc-400"}>{label}<input className="input mt-2" defaultValue={value} /></label>)}<label className="text-sm text-zinc-400">Tipo de persona<select className="input mt-2"><option>Persona física</option><option>Persona moral</option></select></label></div><div className="mt-6 flex items-center justify-end gap-3">{saved && <span className="text-xs text-emerald-400">Cambios guardados en modo demo</span>}<Button type="submit">Guardar perfil fiscal</Button></div></form>;
}

