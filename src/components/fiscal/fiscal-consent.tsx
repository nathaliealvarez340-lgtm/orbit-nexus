"use client";
import { useId } from "react";
import type {
  FiscalConsentPurpose,
  FiscalConsentTerms,
} from "@/types/fiscal-identity";

// Contract copy for the disabled preview while versioned terms are unavailable.
// It is never submitted as consent evidence or assigned a fabricated version.
const previewText: Record<FiscalConsentPurpose, string> = {
  FISCAL_PROFILE_PREFILL:
    "Autorizo a ORBIT NEXUS a leer esta Constancia de Situación Fiscal con la finalidad de extraer y prellenar mis datos fiscales. Podré revisar y corregir la información antes de guardarla. Esta autorización no implica la emisión de CFDI ni autoriza el uso de mi e.firma.",
  CLIENT_FISCAL_PREFILL:
    "Declaro que cuento con facultades o una base legítima para proporcionar y tratar esta información fiscal del cliente con la finalidad de administrar y preparar sus comprobantes fiscales en ORBIT NEXUS.",
};
export function FiscalConsent({
  purpose,
  terms,
  accepted,
  onChange,
  disabled,
}: {
  purpose: FiscalConsentPurpose;
  terms?: FiscalConsentTerms;
  accepted: boolean;
  onChange: (accepted: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="fiscal-consent">
      <label className="fiscal-check">
        <input
          type="checkbox"
          checked={accepted}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={id}
        />
        <span>{terms?.text ?? previewText[purpose]}</span>
      </label>
      <p id={id} className="fiscal-help">
        La autorización corresponde únicamente a este documento y esta
        finalidad.{" "}
        <a href="/privacy" className="underline">
          Consultar Aviso de Privacidad
        </a>
      </p>
    </div>
  );
}
