"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
const billingFields = [
  ["folio", "Folio"],
  ["ticketNumber", "Número de ticket / TC"],
  ["operationNumber", "Número de operación / ID / TR"],
  ["branch", "Sucursal"],
  ["paymentMethod", "Método de pago"],
  ["billingReference", "Referencia de facturación"],
];
const labels: Record<string, string> = Object.fromEntries([
  ...billingFields,
  ["merchant", "Comercio"],
  ["purchaseDate", "Fecha"],
  ["total", "Total (MXN)"],
  ["issuerRfc", "RFC emisor"],
  ["time", "Hora"],
  ["billingUrl", "URL detectada (sin verificar)"],
  ["rfc", "RFC receptor"],
  ["legalName", "Razón social"],
  ["fiscalRegime", "Régimen fiscal"],
  ["postalCode", "Código postal"],
  ["cfdiUse", "Uso CFDI"],
  ["email", "Correo fiscal"],
]);
type Prepared = {
  status: string;
  missing: string[];
  portalUrl: string | null;
  provider: string | null;
  values: Record<string, string>;
  fiscal: Record<string, string> | null;
};
export function AssistedInvoice({ ticketId }: { ticketId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  async function prepare() {
    const res = await fetch("/api/tickets/" + ticketId + "/invoice", {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setPrepared(data);
  }
  return (
    <section className="surface p-6">
      <h2 className="text-lg font-semibold">Facturación asistida</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Orbit reúne los datos para que completes la solicitud en el portal
        oficial del comercio.
      </p>
      <Button
        className="mt-5"
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await prepare();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparando…" : "Facturar ticket"}
      </Button>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      )}
      {prepared && (
        <div className="mt-5 space-y-4">
          {prepared.missing.length > 0 && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-200">
              Falta completar: {prepared.missing.join(", ")}.{" "}
              <Link href="/dashboard/fiscal-profile" className="underline">
                Revisar perfil fiscal
              </Link>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Data title="Datos del ticket" values={prepared.values} />
            {prepared.fiscal && (
              <Data title="Receptor fiscal" values={prepared.fiscal} />
            )}
          </div>
          <details className="rounded-xl border border-white/10 p-4">
            <summary className="cursor-pointer text-sm text-zinc-300">
              Completar referencias del ticket
            </summary>
            <form
              className="mt-4 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                setBusy(true);
                setError("");
                try {
                  const res = await fetch(
                    "/api/tickets/" + ticketId + "/invoice",
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(values),
                    },
                  );
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error);
                  await prepare();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {billingFields.map(([name, label]) => (
                  <label key={name} className="text-xs text-zinc-400">
                    {label}
                    <input
                      className="input mt-2"
                      name={name}
                      defaultValue={prepared.values[name] || ""}
                      maxLength={250}
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-zinc-500">
                Estas referencias ayudan a solicitar la factura. El gasto
                confirmado conserva su importe y fecha.
              </p>
              <Button type="submit" disabled={busy}>
                {busy ? "Guardando…" : "Guardar referencias"}
              </Button>
            </form>
          </details>
          {prepared.portalUrl && (
            <a
              className="inline-flex rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-300"
              href={prepared.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir portal oficial de {prepared.provider} ↗
            </a>
          )}
          <p className="text-xs leading-5 text-zinc-500">
            La redirección no emite una factura ni envía automáticamente estos
            datos. Este ticket seguirá pendiente hasta incorporar su CFDI. Las
            URLs detectadas por OCR no se usan como portales oficiales.
          </p>
        </div>
      )}
    </section>
  );
}
function Data({
  title,
  values,
}: {
  title: string;
  values: Record<string, string>;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-white/10 p-4">
      <div className="flex justify-between gap-3">
        <h3 className="text-sm">{title}</h3>
        <button
          className="text-xs text-violet-300"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                Object.entries(values)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (labels[k] || k) + ": " + v)
                  .join("\n"),
              );
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        {Object.entries(values)
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div className="break-words" key={k}>
              <dt className="text-zinc-500">{labels[k] || k}</dt>
              <dd className="mt-1 text-zinc-300">{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
