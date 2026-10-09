"use client";
import { useEffect, useRef, useState } from "react";
import type {
  FiscalConfirmation as Confirmation,
  FiscalExtractionResult,
} from "@/types/fiscal-identity";
import type { InvoiceFiscalCatalogs } from "@/types/invoice-studio";
import { addressFields } from "@/lib/fiscal-catalogs";
import { Button } from "@/components/ui/button";
import { CsfPrefill } from "./csf-prefill";
import { clientCsfTransport } from "./transport";
import { FiscalCatalogFields } from "./fiscal-catalog-fields";
import { FiscalConfirmation } from "./fiscal-confirmation";
import { FiscalExtractionReview } from "./fiscal-extraction-review";

const fields = [
  ["rfc", "RFC"],
  ["legalName", "Nombre / razón social"],
  ["postalCode", "Código postal"],
  ["email", "Correo"],
  ["phone", "Teléfono (opcional)"],
  ["internalNumber", "Número interno (opcional)"],
  ["foreignTaxId", "Registro fiscal extranjero (opcional)"],
  ...addressFields,
  ["reference", "Referencia (opcional)"],
  ["notes", "Notas (opcional)"],
];
export function ClientFiscalForm({
  initial,
  catalogs,
  onSaved,
  onCancel,
}: {
  initial: Record<string, unknown> | null;
  catalogs: Pick<
    InvoiceFiscalCatalogs,
    "fiscalRegimes" | "cfdiUses" | "paymentForms"
  >;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const id = typeof initial?.id === "string" ? initial.id : undefined;
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(
      fields.map(([key]) => [
        key,
        typeof initial?.[key] === "string" ? initial[key] : "",
      ]),
    ),
    fiscalRegime:
      typeof initial?.fiscalRegime === "string" ? initial.fiscalRegime : "",
    cfdiUse: typeof initial?.cfdiUse === "string" ? initial.cfdiUse : "",
    personType: String(initial?.personType ?? "COMPANY"),
    country: String(initial?.country ?? "MEX"),
    defaultPaymentForm: String(initial?.defaultPaymentForm ?? "99"),
    additionalEmails: Array.isArray(initial?.additionalEmails)
      ? initial.additionalEmails.join(", ")
      : "",
  }));
  const [extraction, setExtraction] = useState<FiscalExtractionResult | null>(
    null,
  );
  const [selectedRegime, setSelectedRegime] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input[name="rfc"]')?.focus();
  }, []);
  const change = (field: string, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setConfirmed(false);
    setError("");
  };
  return (
    <form
      ref={form}
      className="fiscal-ui surface p-6"
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current || documentBusy || !confirmed) return;
        if (!values.fiscalRegime || !values.cfdiUse) {
          setError(
            "Selecciona el régimen fiscal y el Uso CFDI en sus catálogos.",
          );
          return;
        }
        lock.current = true;
        setBusy(true);
        setError("");
        try {
          const confirmation: Confirmation = {
            confirmed: true,
            ...(extraction ? { extractionId: extraction.id } : {}),
          };
          const response = await fetch(
            "/api/clients" + (id ? "/" + encodeURIComponent(id) : ""),
            {
              method: id ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...values,
                ...confirmation,
                additionalEmails: (values.additionalEmails || "")
                  .split(/[;,]/)
                  .map((value) => value.trim())
                  .filter(Boolean),
              }),
            },
          );
          const data = await response.json();
          if (!response.ok) {
            setError(
              typeof data.error === "string"
                ? data.error
                : "No pudimos guardar el cliente. Revisa los datos.",
            );
            return;
          }
          onSaved();
        } catch {
          setError("No pudimos guardar el cliente. Inténtalo nuevamente.");
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <h2 className="font-medium">
        {id ? "Editar cliente" : "Datos del cliente"}
      </h2>
      <CsfPrefill
        purpose="CLIENT_FISCAL_PREFILL"
        clientId={id}
        transport={clientCsfTransport}
        disabled={busy}
        onBusy={setDocumentBusy}
        onDocument={() => {
          setConfirmed(false);
        }}
        onExtraction={(result) => {
          setExtraction(result);
          setSelectedRegime(undefined);
          setConfirmed(false);
        }}
      />
      {extraction && (
        <FiscalExtractionReview
          result={extraction}
          selectedRegime={selectedRegime}
          onApply={change}
          onRegime={(code) => {
            change("fiscalRegime", code);
            setSelectedRegime(code);
          }}
          disabled={busy || documentBusy}
        />
      )}
      <fieldset disabled={busy || documentBusy}>
        <legend className="mb-4 font-medium">
          Datos fiscales y de contacto
        </legend>
        <div className="grid gap-5 md:grid-cols-2">
          {fields.map(([name, label]) => (
            <label key={name} className="text-sm text-zinc-400">
              {label}
              <input
                className="input mt-2"
                name={name}
                value={values[name] || ""}
                onChange={(event) => change(name, event.target.value)}
                required={[
                  "rfc",
                  "legalName",
                  "email",
                  "postalCode",
                  "country",
                ].includes(name)}
                type={name === "email" ? "email" : "text"}
                maxLength={name === "notes" ? 2000 : 254}
              />
              {name === "email" && (
                <span className="fiscal-help block">
                  Dato de contacto requerido actualmente por ORBIT; no es un
                  requisito fiscal para emitir CFDI.
                </span>
              )}
            </label>
          ))}
          <label className="text-sm text-zinc-400">
            Tipo de persona
            <select
              name="personType"
              className="input mt-2"
              value={values.personType}
              onChange={(event) => change("personType", event.target.value)}
            >
              <option value="COMPANY">Persona moral</option>
              <option value="INDIVIDUAL">Persona física</option>
            </select>
          </label>
          <FiscalCatalogFields
            catalogs={catalogs}
            regime={values.fiscalRegime || ""}
            cfdiUse={values.cfdiUse || ""}
            onRegime={(code) => {
              change("fiscalRegime", code);
              setSelectedRegime(code);
            }}
            onUse={(code) => change("cfdiUse", code)}
            disabled={busy || documentBusy}
          />
          <label className="text-sm text-zinc-400">
            Forma de pago predeterminada
            <select
              name="defaultPaymentForm"
              className="input mt-2"
              value={values.defaultPaymentForm}
              onChange={(event) =>
                change("defaultPaymentForm", event.target.value)
              }
            >
              {catalogs.paymentForms.map((option) => (
                <option
                  key={option.code}
                  value={option.code}
                  disabled={!option.active}
                >
                  {option.code} · {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-zinc-400">
            Correos adicionales (separados por coma)
            <input
              name="additionalEmails"
              className="input mt-2"
              value={values.additionalEmails || ""}
              onChange={(event) =>
                change("additionalEmails", event.target.value)
              }
            />
          </label>
        </div>
        <FiscalConfirmation
          client
          checked={confirmed}
          onChange={setConfirmed}
          disabled={!!extraction?.regimes.length && !selectedRegime}
        />
        {!!extraction?.regimes.length && !selectedRegime && (
          <p className="fiscal-pending">
            Selecciona explícitamente un régimen antes de confirmar.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" disabled={!confirmed}>
            {busy ? "Guardando…" : "Guardar cliente"}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="fiscal-error mt-4">
          ⚠ {error}
        </p>
      )}
    </form>
  );
}
