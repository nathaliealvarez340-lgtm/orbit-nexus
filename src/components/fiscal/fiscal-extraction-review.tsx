"use client";
import type {
  ExtractedFiscalFieldStatus,
  FiscalExtractionResult,
  FiscalFieldComparison,
} from "@/types/fiscal-identity";
import { Button } from "@/components/ui/button";
import {
  fiscalFieldLabels,
  FiscalDataComparison,
} from "./fiscal-data-comparison";
import { DetectedRegimes } from "./detected-regimes";

const statusLabels: Record<ExtractedFiscalFieldStatus, string> = {
  DETECTED: "Dato detectado · revisa su contenido",
  LOW_CONFIDENCE: "Lectura poco clara · requiere revisión",
  AMBIGUOUS: "Más de una posibilidad · elige o captura el dato",
  NOT_FOUND: "No identificado · captura manualmente",
};
export function FiscalExtractionReview({
  result,
  selectedRegime,
  onApply,
  onRegime,
  disabled = false,
}: {
  result: FiscalExtractionResult;
  selectedRegime?: string;
  onApply: (field: FiscalFieldComparison["field"], value: string) => void;
  onRegime: (code: string) => void;
  disabled?: boolean;
}) {
  return (
    <section
      aria-label="Revisión de información detectada"
      className="fiscal-review"
    >
      <h3 className="font-medium">
        Información detectada · pendiente de tu revisión
      </h3>
      <p className="fiscal-help" role="status">
        {result.status !== "PROCESSED"
          ? "No pudimos identificar todos los datos de tu Constancia. Puedes revisarlos y completarlos manualmente."
          : "Revisa los datos antes de incorporarlos al formulario. Detectado no significa confirmado."}
      </p>
      <div className="fiscal-detected-grid">
        {Object.entries(result.fields).map(([key, field]) => {
          const name = key as keyof FiscalExtractionResult["fields"];
          return (
            <article
              key={name}
              className="fiscal-detected-field"
              data-status={field.status}
            >
              <h4>{fiscalFieldLabels[name]}</h4>
              <p className="fiscal-help">{statusLabels[field.status]}</p>
              <p className="break-words">
                {field.status === "AMBIGUOUS"
                  ? "Revisa las opciones de lectura"
                  : (field.value ?? "Pendiente de captura")}
              </p>
              {field.status === "AMBIGUOUS"
                ? field.candidates?.map((value, index) => (
                    <Button
                      key={index}
                      variant="secondary"
                      disabled={disabled || name === "operationsStartDate"}
                      onClick={() => onApply(name, value)}
                    >
                      Usar {value}
                    </Button>
                  ))
                : field.value !== null &&
                  name !== "operationsStartDate" && (
                    <Button
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => onApply(name, field.value!)}
                    >
                      Usar en {fiscalFieldLabels[name]}
                    </Button>
                  )}
            </article>
          );
        })}
      </div>
      {!!result.comparison.length && (
        <FiscalDataComparison
          comparisons={result.comparison}
          onApply={onApply}
          disabled={disabled}
        />
      )}
      <DetectedRegimes
        regimes={result.regimes}
        selected={selectedRegime}
        onSelect={onRegime}
        disabled={disabled}
      />
    </section>
  );
}
