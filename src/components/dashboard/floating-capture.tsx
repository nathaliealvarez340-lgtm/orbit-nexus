"use client";
import { ScanLine, X } from "lucide-react";
import { useRef, useState } from "react";
import { UploadZone } from "./upload-zone";
export function FloatingCapture() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-label="Capturar ticket"
        title="Capturar ticket"
        className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-2xl border border-violet-400/40 bg-violet-600 text-white shadow-xl shadow-violet-950/40 transition-transform active:scale-95"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <ScanLine className="size-6" />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="capture-title"
        onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl border border-white/10 bg-[#101014] p-6 text-white backdrop:bg-black/75"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id="capture-title" className="text-lg font-semibold">
            Captura un ticket
          </h2>
          <button
            aria-label="Cerrar captura"
            className="rounded-lg p-2 text-zinc-400"
            onClick={() => dialog.current?.close()}
          >
            <X className="size-5" />
          </button>
        </div>
        {open && <UploadZone />}
      </dialog>
    </>
  );
}
