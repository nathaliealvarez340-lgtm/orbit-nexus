"use client";
import { useId } from "react";
import type {
  FiscalConsentPurpose,
  FiscalConsentTerms,
} from "@/types/fiscal-identity";

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
        <span>
          {terms?.text ??
            (purpose === "CLIENT_FISCAL_PREFILL"
              ? "Declaración de tratamiento del cliente pendiente de cargar."
              : "Autorización de lectura pendiente de cargar.")}
        </span>
      </label>
      <p id={id} className="fiscal-help">
        La autorización corresponde únicamente a este documento y esta
        finalidad.{terms ? ` Versión: ${terms.consentVersion}. ` : " "}
        <a href="/privacy" className="underline">
          Consultar Aviso de Privacidad
        </a>
      </p>
    </div>
  );
}
