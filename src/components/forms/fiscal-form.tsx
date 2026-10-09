"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addressFields } from "@/lib/fiscal-catalogs";
import type {
  FiscalConfirmation as Confirmation,
  FiscalExtractionResult,
  FiscalFieldComparison,
} from "@/types/fiscal-identity";
import type { InvoiceFiscalCatalogs } from "@/types/invoice-studio";
import { CsfPrefill } from "@/components/fiscal/csf-prefill";
import {
  issuerCsfTransport,
  type CsfTransport,
} from "@/components/fiscal/transport";
import { FiscalConfirmation } from "@/components/fiscal/fiscal-confirmation";
import { FiscalCatalogFields } from "@/components/fiscal/fiscal-catalog-fields";
import { FiscalExtractionReview } from "@/components/fiscal/fiscal-extraction-review";
import {
  FiscalDataComparison,
  fiscalFieldLabels,
} from "@/components/fiscal/fiscal-data-comparison";

const fields = [
  ["rfc", "RFC", "text"],
  ["legalName", "Razón social", "text"],
  ["postalCode", "Código postal fiscal", "text"],
  ["email", "Correo fiscal", "email"],
];
export function FiscalForm({
  initial,
  sourceValues,
  catalogs,
  documentId,
  readOnly = false,
  csfTransport = issuerCsfTransport,
}: {
  initial: Record<string, string>;
  sourceValues?: Record<string, string> | null;
  catalogs: Pick<InvoiceFiscalCatalogs, "fiscalRegimes" | "cfdiUses">;
  documentId?: string;
  readOnly?: boolean;
  csfTransport?: CsfTransport;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    ...initial,
    personType: initial.personType || "COMPANY",
    country: initial.country || "MEX",
  });
  const [csf, setCsf] = useState(initial.csfDocumentId || "");
  const [extraction, setExtraction] = useState<FiscalExtractionResult | null>(
    null,
  );
  const [selectedRegime, setSelectedRegime] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const router = useRouter();
  const change = (field: string, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setConfirmed(false);
    setMessage("");
  };
  const comparisons: FiscalFieldComparison[] = Object.entries(
    sourceValues ?? {},
  )
    .filter(
      ([key, value]) =>
        Object.hasOwn(fiscalFieldLabels, key) && typeof value === "string",
    )
    .map(([key, value]) => ({
      field: key as FiscalFieldComparison["field"],
      current: initial[key] || null,
      detected: value,
      changed: initial[key] !== value,
    }));
  return (
    <form
      className="fiscal-ui surface p-6"
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current || readOnly || documentBusy || !confirmed) return;
        if (!values.fiscalRegime || !values.cfdiUse) {
          setFailed(true);
          setMessage(
            "Selecciona el régimen fiscal y el Uso CFDI en sus catálogos.",
          );
          return;
        }
        lock.current = true;
        setBusy(true);
        setMessage("");
        setFailed(false);
        try {
          const confirmation: Confirmation = {
            confirmed: true,
            ...(extraction ? { extractionId: extraction.id } : {}),
          };
          const response = await fetch("/api/fiscal-profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...values,
              ...confirmation,
              documentId,
              csfDocumentId: csf || undefined,
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            setFailed(true);
            setMessage(
              typeof data.error === "string"
                ? data.error
                : "No pudimos guardar el perfil. Revisa los campos indicados.",
            );
            return;
          }
          setMessage("✓ Información guardada correctamente");
          setConfirmed(false);
          router.refresh();
        } catch {
          setFailed(true);
          setMessage(
            "No pudimos guardar el perfil fiscal. Inténtalo nuevamente.",
          );
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <CsfPrefill
        purpose="FISCAL_PROFILE_PREFILL"
        documentId={csf}
        transport={csfTransport}
        disabled={readOnly || busy}
        onBusy={setDocumentBusy}
        onDocument={(id) => {
          setCsf(id);
          setConfirmed(false);
          setMessage("");
        }}
        onExtraction={(result) => {
          setExtraction(result);
          setSelectedRegime(undefined);
          setConfirmed(false);
          setMessage("");
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
          disabled={readOnly || busy || documentBusy}
        />
      )}
      {!!comparisons.length && (
        <div className="mb-6">
          <p className="fiscal-help">
            Información del receptor del XML cargado. Compárala con tu perfil;
            no se incorpora automáticamente.
          </p>
          <FiscalDataComparison
            comparisons={comparisons}
            onApply={change}
            disabled={readOnly || busy || documentBusy}
          />
        </div>
      )}
      <fieldset disabled={readOnly || busy || documentBusy}>
        <legend className="mb-5 font-medium">
          2. Datos fiscales · revisa y completa
        </legend>
        <div className="grid gap-5 md:grid-cols-2">
          {fields.map(([name, label, type]) => (
            <label key={name} className="text-sm text-zinc-400">
              {label}
              <input
                name={name}
                type={type}
                className="input mt-2"
                value={values[name] || ""}
                onChange={(event) => change(name, event.target.value)}
                required
                maxLength={
                  name === "legalName" ? 200 : name === "email" ? 254 : 20
                }
              />
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
              <option value="INDIVIDUAL">Persona física</option>
              <option value="COMPANY">Persona moral</option>
            </select>
          </label>
          <FiscalCatalogFields
            catalogs={catalogs}
            issuer
            regime={values.fiscalRegime || ""}
            cfdiUse={values.cfdiUse || ""}
            onRegime={(code) => {
              change("fiscalRegime", code);
              setSelectedRegime(code);
            }}
            onUse={(code) => change("cfdiUse", code)}
            disabled={readOnly || busy || documentBusy}
          />
          {addressFields.map(([name, label]) => (
            <label key={name} className="text-sm text-zinc-400">
              {label}
              <input
                name={name}
                className="input mt-2"
                maxLength={200}
                value={values[name] || ""}
                onChange={(event) => change(name, event.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="fiscal-help">
          La dirección completa y la constancia son obligatorias para preparar
          facturas en ORBIT. Puedes guardar un perfil incompleto para
          completarlo después.
        </p>
        <FiscalConfirmation
          checked={confirmed}
          onChange={setConfirmed}
          disabled={!!extraction?.regimes.length && !selectedRegime}
        />
        {!!extraction?.regimes.length && !selectedRegime && (
          <p className="fiscal-pending">
            Selecciona explícitamente el régimen detectado o una opción del
            catálogo antes de confirmar.
          </p>
        )}
        {!readOnly && (
          <div className="mt-6 flex justify-end">
            <Button type="submit" disabled={busy || documentBusy || !confirmed}>
              {busy ? "Guardando…" : "Confirmar y guardar perfil"}
            </Button>
          </div>
        )}
      </fieldset>
      {readOnly && (
        <p className="fiscal-help">
          Solo propietarios y administradores pueden actualizar el perfil.
        </p>
      )}
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={
            failed ? "fiscal-error mt-4" : "mt-4 text-sm text-violet-300"
          }
        >
          {failed ? "⚠ " : ""}
          {message}
        </p>
      )}
    </form>
  );
}
