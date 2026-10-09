"use client";
import type { ExtractedFiscalRegime } from "@/types/fiscal-identity";
export function DetectedRegimes({
  regimes,
  selected,
  onSelect,
  disabled = false,
}: {
  regimes: ExtractedFiscalRegime[];
  selected?: string;
  onSelect: (code: string) => void;
  disabled?: boolean;
}) {
  if (!regimes.length)
    return (
      <p className="fiscal-help">
        No se identificó un régimen. Selecciónalo en el catálogo del formulario.
      </p>
    );
  return (
    <fieldset className="fiscal-regimes" disabled={disabled}>
      <legend>Regímenes detectados · elige el que utilizarás</legend>
      <p className="fiscal-help">
        Ningún régimen se selecciona automáticamente. La verificación depende
        del catálogo del servidor.
      </p>
      {regimes.map((regime, index) => (
        <label className="fiscal-check" key={`${regime.code}-${index}`}>
          <input
            type="radio"
            name="detected-regime"
            checked={selected === regime.code}
            disabled={!regime.catalogVerified}
            onChange={() => onSelect(regime.code)}
          />
          <span>
            {regime.code} · {regime.label ?? "Descripción pendiente"}
            <span className="fiscal-help block">
              {regime.catalogVerified
                ? "Identificado en el catálogo oficial"
                : "No verificado · requiere revisión en el catálogo"}
              {regime.status !== "DETECTED" ? " · Revisar lectura" : ""}
            </span>
            {(regime.startDate || regime.endDate) && (
              <span className="fiscal-help block">
                Inicio: {regime.startDate ?? "No identificado"} · Fin:{" "}
                {regime.endDate ?? "No identificado"}
              </span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
