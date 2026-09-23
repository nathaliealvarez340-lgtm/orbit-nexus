"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
export function InvoiceImport({ ticketId }: { ticketId: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const router = useRouter();
  return (
    <details className="surface p-6">
      <summary className="cursor-pointer text-sm font-medium">
        ¿Ya obtuviste tu factura? Incorporar XML / PDF
      </summary>
      <form
        className="mt-5 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          const data = new FormData(e.currentTarget);
          const xml = data.get("xml") as File,
            pdf = data.get("pdf") as File;
          if (
            !xml?.size ||
            xml.size > 1024 * 1024 ||
            !xml.name.toLowerCase().endsWith(".xml") ||
            pdf?.size > 10 * 1024 * 1024
          ) {
            setError(
              "Selecciona un XML válido de hasta 1 MB y PDF opcional de hasta 10 MB.",
            );
            return;
          }
          data.set("confirmed", "true");
          lock.current = true;
          setBusy(true);
          setError("");
          try {
            const res = await fetch(
              "/api/tickets/" + ticketId + "/invoice-document",
              { method: "POST", body: data },
            );
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <label className="block text-sm text-zinc-400">
          XML del CFDI 4.0
          <input
            className="mt-2 block w-full text-xs"
            name="xml"
            type="file"
            accept=".xml"
            required
          />
        </label>
        <label className="block text-sm text-zinc-400">
          PDF opcional
          <input
            className="mt-2 block w-full text-xs"
            name="pdf"
            type="file"
            accept=".pdf"
          />
        </label>
        <label className="flex items-start gap-3 text-xs leading-5 text-zinc-400">
          <input
            className="mt-1 accent-violet-500"
            name="reviewed"
            type="checkbox"
            required
          />
          Revisé la factura y confirmo que corresponde a este ticket.
        </label>
        <p className="text-xs text-zinc-500">
          Se comprobarán estructura, UUID, RFC receptor y total. La validación
          de autenticidad y estado ante el SAT está pendiente de integración.
          Orbit no emite este comprobante.
        </p>
        <Button disabled={busy} type="submit">
          {busy ? "Guardando…" : "Incorporar factura"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
