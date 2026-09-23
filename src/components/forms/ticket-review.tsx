"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
const extra = [
  ["issuerRfc", "RFC emisor"],
  ["time", "Hora"],
  ["subtotal", "Subtotal"],
  ["tax", "IVA"],
  ["ticketNumber", "Número de ticket / TC"],
  ["operationNumber", "Número de operación / ID / TR"],
  ["branch", "Sucursal"],
  ["paymentMethod", "Método de pago"],
  ["billingReference", "Referencia de facturación"],
  ["billingUrl", "URL detectada (sin verificar)"],
];
export function TicketReview({
  id,
  status,
  provider,
  confidence,
  fields,
}: {
  id: string;
  status: string;
  provider?: string;
  confidence?: number | null;
  fields: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const reviewable = ["REVIEW", "READY", "ERROR"].includes(status);
  async function analyze() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/tickets/" + id + "/analyze", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="surface p-6">
      <p className="text-xs uppercase tracking-widest text-violet-400">
        Revisión humana
      </p>
      <h2 className="mt-3 text-xl font-semibold">Datos detectados</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        {provider === "manual"
          ? "El OCR aún no está conectado. No se detectaron datos automáticamente; completa la información de tu ticket."
          : status === "ERROR"
            ? "No se pudo completar el análisis. Puedes reintentarlo o capturar los datos manualmente."
            : "Revisa y corrige cada dato antes de registrar el gasto."}
        {typeof confidence === "number" &&
          " Confianza del proveedor: " + Math.round(confidence * 100) + "%."}
      </p>
      {!reviewable && (
        <div className="mt-5">
          <Button onClick={analyze} disabled={busy}>
            {busy
              ? "Analizando…"
              : status === "ANALYZING"
                ? "Reintentar análisis"
                : "Analizar ticket"}
          </Button>
          {status === "ANALYZING" && (
            <p className="mt-2 text-xs text-zinc-500">
              Un análisis interrumpido se puede reintentar después de cinco
              minutos.
            </p>
          )}
        </div>
      )}
      {reviewable && (
        <form
          className="mt-6 space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setError("");
            const body = Object.fromEntries(new FormData(e.currentTarget));
            try {
              const res = await fetch("/api/tickets/" + id + "/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              const data = await res.json();
              if (!res.ok)
                throw new Error(
                  data.fields
                    ? Object.values(data.fields).flat().join(" ")
                    : data.error,
                );
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["merchant", "Comercio", "text"],
              ["purchaseDate", "Fecha", "date"],
              ["total", "Total (MXN)", "number"],
              ["folio", "Folio", "text"],
            ].map(([name, label, type]) => (
              <label className="text-sm text-zinc-400" key={name}>
                {label}
                <input
                  name={name}
                  type={type}
                  defaultValue={fields[name] || ""}
                  className="input mt-2"
                  required={name !== "folio"}
                  maxLength={name === "merchant" ? 150 : 250}
                  step={type === "number" ? "0.01" : undefined}
                  min={type === "number" ? "0.01" : undefined}
                />
              </label>
            ))}
          </div>
          <details className="rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm text-zinc-400">
              Información adicional
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {extra.map(([name, label]) => (
                <label className="text-xs text-zinc-400" key={name}>
                  {label}
                  <input
                    name={name}
                    defaultValue={fields[name] || ""}
                    className="input mt-2"
                    maxLength={name === "billingUrl" ? 1000 : 250}
                  />
                </label>
              ))}
            </div>
          </details>
          <Button type="submit" disabled={busy} className="disabled:opacity-50">
            {busy ? "Registrando…" : "Confirmar y registrar"}
          </Button>
          {status === "ERROR" && (
            <Button variant="ghost" onClick={analyze} disabled={busy}>
              Reintentar OCR
            </Button>
          )}
          <p className="text-xs text-zinc-500">
            Al confirmar, el gasto se asignará al mes de la fecha que indicaste.
          </p>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      )}
      <Link
        href="/dashboard/tickets"
        className="mt-5 inline-block text-xs text-zinc-400"
      >
        Volver a tickets
      </Link>
    </div>
  );
}
