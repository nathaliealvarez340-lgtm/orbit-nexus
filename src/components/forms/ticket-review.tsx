"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { extractionWarnings } from "@/lib/ticket-extraction";
import { normalizeBillingUrl } from "@/lib/billing-url";

const primary = [
  ["merchant", "Comercio", "text"],
  ["issuerRfc", "RFC emisor", "text"],
  ["purchaseDate", "Fecha", "date"],
  ["total", "Total", "number"],
  ["ticketNumber", "Número de ticket / TC", "text"],
  ["folio", "Folio", "text"],
  ["operationNumber", "Número de operación / ID / TR", "text"],
  ["branch", "Sucursal", "text"],
  ["billingReference", "Código de facturación", "text"],
  ["billingUrl", "URL del portal de facturación", "text"],
];
const additional = [
  ["time", "Hora", "text"],
  ["subtotal", "Subtotal", "number"],
  ["tax", "IVA", "number"],
  ["terminalNumber", "Caja / terminal", "text"],
  ["paymentMethod", "Método de pago", "text"],
  ["paymentReference", "Referencia de pago", "text"],
];
export function TicketReview({
  id,
  status,
  provider,
  confidence,
  fields,
  warnings = [],
}: {
  id: string;
  status: string;
  provider?: string;
  confidence?: number | null;
  fields: Record<string, string>;
  warnings?: string[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({
    ...fields,
    currency: fields.currency || "MXN",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const reviewable = [
    "UPLOADED",
    "REVIEW",
    "READY",
    "ERROR",
    "OCR_FAILED",
    "NEEDS_MANUAL_INPUT",
  ].includes(status);
  useEffect(() => {
    if (status !== "ANALYZING") return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [status, router]);
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
      router.refresh();
    }
  }
  const renderInput = ([name, label, type]: string[]) => (
    <div key={name}>
      <label htmlFor={`review-${name}`} className="text-sm text-zinc-400">
        {name === "total" ? `Total (${values.currency})` : label}
      </label>
      <input
        id={`review-${name}`}
        name={name}
        type={type}
        value={values[name] || ""}
        onChange={(e) =>
          setValues((old) => ({ ...old, [name]: e.target.value }))
        }
        className="input mt-2"
        required={["merchant", "purchaseDate", "total"].includes(name)}
        maxLength={
          name === "billingUrl" ? 1000 : name === "merchant" ? 150 : 250
        }
        step={type === "number" ? "0.01" : undefined}
        min={type === "number" ? "0" : undefined}
        aria-describedby={`source-${name}`}
      />
      <p id={`source-${name}`} className="mt-1 text-xs text-zinc-400">
        {values[name]
          ? fields[name] === values[name]
            ? "Detectado automáticamente"
            : fields[name]
              ? "Corregido por ti"
              : "Introducido por ti"
          : "Sin detectar"}
      </p>
      {name === "billingUrl" && (
        <p className="mt-2 text-xs leading-5 text-zinc-400">
          Pega la dirección oficial que aparece en tu ticket o el portal donde
          normalmente solicitas tu factura. Solo se guardará; no se abrirá.
        </p>
      )}
    </div>
  );
  return (
    <div className="surface p-6">
      <p className="text-xs uppercase tracking-widest text-violet-400">
        Revisión humana
      </p>
      <h2 className="mt-3 text-xl font-semibold">
        {status === "REVIEW" ? "TICKET ANALIZADO" : "Datos del ticket"}
      </h2>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        {provider === "manual"
          ? "El OCR aún no está conectado. Completa la información del ticket; los valores no se inventan."
          : status === "OCR_FAILED" || status === "ERROR"
            ? "No pudimos leer este ticket."
            : "Revisa y corrige cada dato antes de confirmar."}
        {typeof confidence === "number" &&
          ` Confianza del proveedor: ${Math.round(confidence * 100)}%.`}
      </p>
      {warnings.length > 0 && (
        <ul
          aria-label="Avisos de extracción"
          className="mt-4 list-inside list-disc space-y-2 rounded-xl border border-amber-400/20 p-4 text-xs leading-5 text-amber-200"
        >
          {warnings.map((code) => (
            <li key={code}>
              {extractionWarnings[code] || "Revisa los datos del original."}
            </li>
          ))}
        </ul>
      )}
      {fields.dateRaw && !fields.purchaseDate && (
        <p className="mt-3 text-sm text-zinc-400">
          Fecha original detectada: {fields.dateRaw}
        </p>
      )}
      {fields.qrPayload && (
        <details className="mt-4 text-sm text-zinc-400">
          <summary className="cursor-pointer">
            Contenido del QR (sin abrir)
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
            {fields.qrPayload}
          </pre>
        </details>
      )}
      {[
        "UPLOADED",
        "ANALYZING",
        "ERROR",
        "OCR_FAILED",
        "NEEDS_MANUAL_INPUT",
      ].includes(status) && (
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={analyze} disabled={busy}>
            {busy
              ? "Analizando…"
              : status === "UPLOADED"
                ? "Analizar ticket"
                : "Reintentar análisis"}
          </Button>
          {reviewable && (
            <Button
              variant="ghost"
              onClick={() =>
                document.getElementById("review-merchant")?.focus()
              }
            >
              Introducir datos manualmente
            </Button>
          )}
          <Link
            href="/dashboard/tickets/new"
            className="text-sm text-violet-300"
          >
            Subir otra imagen
          </Link>
          <Link
            href="/dashboard/tickets/new"
            className="text-sm text-violet-300"
          >
            Capturar nuevamente
          </Link>
          {status === "ANALYZING" && (
            <p role="status" className="w-full text-xs text-zinc-400">
              Análisis en curso. Un proceso interrumpido se puede reintentar
              después de cinco minutos.
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
            if (values.billingUrl && !normalizeBillingUrl(values.billingUrl)) {
              setError(
                "Introduce una URL web pública válida, sin credenciales.",
              );
              return;
            }
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              const res = await fetch("/api/tickets/" + id + "/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                  Object.fromEntries(new FormData(e.currentTarget)),
                ),
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
            {primary.map(renderInput)}
            <div>
              <label
                htmlFor="review-currency"
                className="text-sm text-zinc-400"
              >
                Moneda
              </label>
              <input
                id="review-currency"
                name="currency"
                className="input mt-2"
                value={values.currency}
                required
                pattern="[A-Za-z]{3}"
                maxLength={3}
                onChange={(e) =>
                  setValues((old) => ({
                    ...old,
                    currency: e.target.value.toUpperCase(),
                  }))
                }
              />
              <p className="mt-1 text-xs text-zinc-400">
                {fields.currency === values.currency
                  ? "Detectado automáticamente"
                  : "Confirma la moneda: MXN, USD, EUR u otro código de tres letras."}
              </p>
            </div>
          </div>
          <details
            open={additional.some(([name]) => Boolean(fields[name]))}
            className="rounded-xl border border-white/10 p-4"
          >
            <summary className="cursor-pointer text-sm text-zinc-400">
              Información adicional
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {additional.map(renderInput)}
            </div>
          </details>
          {values.currency !== "MXN" && (
            <p className="text-sm text-amber-200">
              Se guardará el ticket confirmado en {values.currency}. No se
              sumará a gastos MXN: no se realiza conversión de monedas.
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Registrando…" : "Confirmar datos"}
          </Button>
          <p className="text-xs text-zinc-400">
            Los gastos MXN se registran con el importe y la fecha confirmados.
            Confirmar no factura ni abre portales.
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
