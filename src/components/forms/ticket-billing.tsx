"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { FieldMapping } from "@/services/billing/types";
type Attempt = {
  id: string;
  status: string;
  providerName: string;
  billingUrl: string;
  fields: FieldMapping[];
  error: string | null;
  missing: string[];
  submittedAt: string | null;
  createdAt: string;
  events: { type: string; createdAt: string }[];
  invoice?: {
    uuid: string;
    xmlDocumentId: string;
    pdfDocumentId?: string | null;
  } | null;
};
type Options = {
  global: {
    id: string;
    name: string;
    portalUrl: string | null;
    mode: string;
  }[];
  frequent: {
    id: string;
    name: string;
    portalUrl: string | null;
    favorite: boolean;
  }[];
  suggestedId: string | null;
  candidateUrl: string;
  attempts: Attempt[];
};
const states: Record<string, string> = {
  PREPARING: "Preparando datos y comprobando el portal",
  AWAITING_APPROVAL: "Factura preparada",
  SUBMITTING: "Procesando envío; no vuelvas a solicitar",
  WAITING_PROVIDER: "Solicitud enviada. Esperando comprobante",
  SUCCEEDED: "Factura obtenida",
  FAILED: "Facturación fallida",
  NEEDS_MANUAL_ACTION: "Requiere intervención",
  CANCELLED: "Preparación cancelada",
};
const events: Record<string, string> = {
  PROVIDER_MATCHED: "Portal seleccionado",
  REQUIREMENTS_DETECTED: "Requisitos revisados",
  URL_VALIDATED: "Dirección validada",
  FORM_PREPARED: "Campos completados y verificados",
  USER_APPROVED: "Envío aprobado",
  SUBMITTED: "Solicitud enviada",
  RESULT_RECEIVED: "Resultado recibido",
  CFDI_VALIDATED: "CFDI validado",
  COMPLETED: "Factura incorporada",
  FAILED: "Requiere revisión",
  CANCELLED: "Preparación cancelada",
};
async function request(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "No pudimos completar la operación.");
  return data;
}
export function TicketBilling({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null),
    [selection, setSelection] = useState(""),
    [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [favorite, setFavorite] = useState(false),
    [confirmedPortal, setConfirmedPortal] = useState(false);
  const [approval, setApproval] = useState<{
      attemptId: string;
      token: string;
    } | null>(null),
    [copied, setCopied] = useState(false);
  const endpoint = "/api/tickets/" + ticketId + "/billing";
  const attempt = options?.attempts[0];
  const active =
    attempt &&
    [
      "PREPARING",
      "AWAITING_APPROVAL",
      "SUBMITTING",
      "WAITING_PROVIDER",
    ].includes(attempt.status);
  useEffect(() => {
    let mounted = true;
    request(endpoint)
      .then((data: Options) => {
        if (!mounted) return;
        setOptions(data);
        setSelection(
          data.suggestedId ? "global:" + data.suggestedId : "manual",
        );
        setUrl(
          data.suggestedId
            ? (data.global.find((p) => p.id === data.suggestedId)?.portalUrl ??
                "")
            : data.candidateUrl,
        );
      })
      .catch(() => {
        if (mounted)
          setError("No pudimos cargar los portales. Recarga la página.");
      });
    return () => {
      mounted = false;
    };
  }, [endpoint]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setOptions(await request(endpoint));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function attemptAction(action: string, body = {}) {
    return request("/api/billing-attempts/" + attempt!.id + "/" + action, body);
  }
  return (
    <section
      className="surface min-w-0 p-5 sm:p-6"
      aria-labelledby="ticket-billing-title"
    >
      <h2 id="ticket-billing-title" className="text-lg font-semibold">
        Portal de facturación
      </h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Confirma el portal antes de compartir datos fiscales. El envío final
        siempre requiere tu aprobación. Los portales sin automatización
        verificada se completan manualmente.
      </p>
      {!options && !error && (
        <p role="status" className="mt-4 text-sm">
          Cargando portales…
        </p>
      )}
      {options &&
        !active &&
        !attempt?.submittedAt &&
        attempt?.status !== "SUCCEEDED" && (
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                setApproval(null);
                await request(endpoint, {
                  companyId: selection.startsWith("global:")
                    ? selection.slice(7)
                    : undefined,
                  providerId: selection.startsWith("frequent:")
                    ? selection.slice(9)
                    : undefined,
                  url,
                  favorite,
                  confirmedPortal,
                });
              });
            }}
          >
            <label className="block text-sm">
              Proveedor
              <select
                className="input mt-2 w-full"
                value={selection}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelection(value);
                  setConfirmedPortal(false);
                  const provider = value.startsWith("global:")
                    ? options.global.find((p) => p.id === value.slice(7))
                    : options.frequent.find((p) => p.id === value.slice(9));
                  setUrl(provider?.portalUrl ?? options.candidateUrl);
                }}
              >
                <option value="manual">Otro portal / URL del ticket</option>
                <optgroup label="Catálogo de ORBIT">
                  {options.global.map((p) => (
                    <option key={p.id} value={"global:" + p.id}>
                      {p.name} ·{" "}
                      {p.mode === "AUTOMATED"
                        ? "Adapter configurado"
                        : "Asistido"}
                    </option>
                  ))}
                </optgroup>
                {options.frequent.length > 0 && (
                  <optgroup label="Frecuentes de esta empresa">
                    {options.frequent.map((p) => (
                      <option key={p.id} value={"frequent:" + p.id}>
                        {p.favorite ? "★ " : ""}
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="block text-sm">
              URL del portal de facturación
              <input
                className="input mt-2 w-full"
                required
                maxLength={1000}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setConfirmedPortal(false);
                }}
              />
            </label>
            <p className="text-xs leading-5 text-zinc-400">
              Pega la dirección oficial que aparece en tu ticket o el portal
              donde normalmente solicitas tu factura.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={favorite}
                onChange={(e) => setFavorite(e.target.checked)}
              />
              Guardar como proveedor favorito de esta empresa
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                required
                type="checkbox"
                className="mt-1"
                checked={confirmedPortal}
                onChange={(e) => setConfirmedPortal(e.target.checked)}
              />
              Confirmo que este es el portal del comercio y autorizo preparar
              sus campos con los datos mostrados de mi empresa.
            </label>
            <Button type="submit" disabled={busy || !confirmedPortal}>
              {busy ? "Preparando…" : "Preparar en portal"}
            </Button>
          </form>
        )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-300">
          {error}
        </p>
      )}
      {attempt && (
        <div className="mt-5 space-y-4">
          <h3 aria-live="polite" className="text-base font-semibold">
            {states[attempt.status] ?? attempt.status}
          </h3>
          <p className="break-words text-sm text-zinc-300">
            {attempt.providerName} · {attempt.billingUrl}
          </p>
          {attempt.error && (
            <p className="rounded-lg border border-amber-300/30 p-3 text-sm text-amber-200">
              {attempt.error}
            </p>
          )}
          {!!attempt.missing?.length && (
            <p className="text-sm text-amber-200">
              Falta completar: {attempt.missing.join(", ")}.{" "}
              <Link className="underline" href="/dashboard/fiscal-profile">
                Completar Perfil Fiscal
              </Link>
            </p>
          )}
          <details
            open={attempt.status === "AWAITING_APPROVAL"}
            className="rounded-xl border border-white/10 p-4"
          >
            <summary className="cursor-pointer text-sm">
              Revisar datos y origen de cada campo
            </summary>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {attempt.fields
                .filter((f) => f.value || f.required)
                .map((f) => (
                  <div key={f.key} className="min-w-0 text-sm">
                    <dt className="text-zinc-400">{f.label}</dt>
                    <dd className="break-words">
                      {f.value || "Sin dato"}
                      <span className="mt-1 block text-xs text-zinc-400">
                        {f.source === "FISCAL_PROFILE"
                          ? "Perfil fiscal de la empresa"
                          : f.source === "TICKET_CONFIRMED"
                            ? "Ticket confirmado"
                            : "Requiere captura"}
                      </span>
                    </dd>
                  </div>
                ))}
            </dl>
            <button
              type="button"
              className="mt-4 text-sm text-violet-300"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    attempt.fields
                      .filter((f) => f.value)
                      .map((f) => f.label + ": " + f.value)
                      .join("\n"),
                  );
                  setCopied(true);
                } catch {
                  setError(
                    "No se pudo copiar. Selecciona los datos manualmente.",
                  );
                }
              }}
            >
              {copied ? "Datos copiados" : "Copiar datos para el portal"}
            </button>
          </details>
          {attempt.status === "AWAITING_APPROVAL" && (
            <div className="flex flex-wrap gap-3">
              {approval?.attemptId === attempt.id ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await attemptAction("submit", {
                        approvalToken: approval.token,
                      });
                      setApproval(null);
                    })
                  }
                >
                  {busy ? "Procesando…" : "Confirmar y facturar"}
                </Button>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const result = await attemptAction("review");
                      setApproval({
                        attemptId: attempt.id,
                        token: result.approvalToken,
                      });
                    })
                  }
                >
                  He revisado los datos
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await attemptAction("cancel");
                    setApproval(null);
                  })
                }
              >
                Cancelar / Revisar
              </Button>
            </div>
          )}
          {attempt.status === "PREPARING" && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await attemptAction("cancel");
                })
              }
            >
              Cancelar preparación
            </Button>
          )}
          {attempt.submittedAt && attempt.status !== "SUCCEEDED" && (
            <Button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await attemptAction("collect");
                })
              }
            >
              {busy ? "Consultando…" : "Consultar resultado sin reenviar"}
            </Button>
          )}
          {attempt.status === "NEEDS_MANUAL_ACTION" &&
            attempt.events?.some((e) => e.type === "URL_VALIDATED") && (
              <>
                <a
                  href={attempt.billingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-lg border border-violet-300/30 px-4 py-3 text-sm text-violet-300"
                >
                  Abrir portal confirmado ↗
                </a>
                <p className="text-xs leading-5 text-zinc-400">
                  Abrir el portal no factura el ticket.{" "}
                  {attempt.submittedAt
                    ? "Consulta primero si ya se emitió; no hagas una segunda solicitud."
                    : "Completa los pasos manualmente."}{" "}
                  Después incorpora el XML y PDF en este ticket.
                </p>
              </>
            )}
          {attempt.invoice && (
            <p className="break-all text-sm">
              UUID: {attempt.invoice.uuid} ·{" "}
              <a
                className="text-violet-300 underline"
                href={"/api/documents/" + attempt.invoice.xmlDocumentId}
              >
                XML privado
              </a>
              {attempt.invoice.pdfDocumentId && (
                <>
                  {" "}
                  ·{" "}
                  <a
                    className="text-violet-300 underline"
                    href={"/api/documents/" + attempt.invoice.pdfDocumentId}
                  >
                    PDF privado
                  </a>
                </>
              )}
            </p>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-300">
              Historial de intentos ({options.attempts.length})
            </summary>
            <ol className="mt-3 space-y-4">
              {options.attempts.map((a) => (
                <li key={a.id}>
                  <p>
                    {states[a.status]} ·{" "}
                    {new Date(a.createdAt).toLocaleString("es-MX")}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                    {a.events?.map((e, i) => (
                      <li key={i}>
                        {events[e.type] ?? e.type} ·{" "}
                        {new Date(e.createdAt).toLocaleTimeString("es-MX")}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </section>
  );
}
