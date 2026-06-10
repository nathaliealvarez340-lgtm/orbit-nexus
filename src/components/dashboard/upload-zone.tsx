"use client";

import { FileImage, FileText, ScanLine, UploadCloud } from "lucide-react";
import { useState } from "react";

export function UploadZone({ fiscal = false }: { fiscal?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <div>
      <label className="group grid min-h-64 cursor-pointer place-items-center rounded-3xl border border-dashed border-white/15 bg-white/[.02] p-8 text-center transition-colors hover:border-violet-400/40 hover:bg-violet-500/[.04]">
        <input type="file" className="sr-only" accept={fiscal ? ".xml,.pdf,image/*" : ".pdf,image/*"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div>
          <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-violet-500/20 bg-violet-500/10 text-violet-400"><UploadCloud className="size-6" /></span>
          <p className="mt-5 font-medium">{file ? file.name : fiscal ? "Sube tu documento fiscal" : "Arrastra tu ticket aquí"}</p>
          <p className="mt-2 text-sm text-zinc-500">{file ? `${(file.size / 1024).toFixed(1)} KB · Listo para analizar` : fiscal ? "XML, PDF o Constancia de Situación Fiscal" : "Foto, imagen o PDF · Máximo 10 MB"}</p>
        </div>
      </label>
      {file && <div className="surface mt-5 flex items-center gap-4 p-4"><span className="grid size-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400">{fiscal ? <FileText className="size-5" /> : <FileImage className="size-5" />}</span><div><p className="text-sm font-medium">Documento listo</p><p className="text-xs text-zinc-500">La extracción iniciará después de tu confirmación.</p></div><ScanLine className="ml-auto size-5 text-violet-400" /></div>}
    </div>
  );
}

