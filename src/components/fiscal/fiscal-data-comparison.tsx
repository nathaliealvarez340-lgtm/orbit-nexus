"use client";
import type { FiscalFieldComparison } from "@/types/fiscal-identity";
import { Button } from "@/components/ui/button";
export const fiscalFieldLabels: Record<FiscalFieldComparison["field"], string> =
  {
    rfc: "RFC",
    legalName: "Nombre / razón social",
    personType: "Tipo de persona",
    postalCode: "Código postal fiscal",
    street: "Calle",
    exteriorNumber: "Número exterior",
    interiorNumber: "Número interior",
    colony: "Colonia",
    locality: "Localidad",
    municipality: "Municipio / alcaldía",
    state: "Estado",
    country: "País",
    operationsStartDate: "Inicio de operaciones",
    fiscalRegime: "Régimen fiscal",
  };
export function FiscalDataComparison({
  comparisons,
  onApply,
  disabled = false,
}: {
  comparisons: FiscalFieldComparison[];
  onApply: (field: FiscalFieldComparison["field"], value: string) => void;
  disabled?: boolean;
}) {
  return (
    <section aria-label="Comparar datos fiscales" className="fiscal-comparison">
      <h3 className="font-medium">Diferencias con la información guardada</h3>
      <p className="fiscal-help">
        Los datos actuales se conservan. Elige qué cambiar y revisa el
        formulario antes de confirmar.
      </p>
      {comparisons.map((item) => (
        <div className="fiscal-comparison-row" key={item.field}>
          <h4>{fiscalFieldLabels[item.field]}</h4>
          <dl>
            <div>
              <dt>Actual</dt>
              <dd>{item.current || "Sin dato"}</dd>
            </div>
            <div>
              <dt>Detectado</dt>
              <dd>{item.detected || "Pendiente de captura"}</dd>
            </div>
          </dl>
          {item.changed && item.field === "fiscalRegime" && (
            <p className="fiscal-help">
              Selecciona el régimen en el catálogo del formulario; esta lectura
              no lo valida.
            </p>
          )}
          {item.changed && item.field === "operationsStartDate" && (
            <p className="fiscal-help">
              Fecha informativa; aún no se guarda en el perfil.
            </p>
          )}
          {item.changed &&
            item.detected !== null &&
            item.field !== "fiscalRegime" &&
            item.field !== "operationsStartDate" && (
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => onApply(item.field, item.detected!)}
              >
                Usar dato detectado
              </Button>
            )}
          {!item.changed && <p className="fiscal-help">Sin cambios</p>}
        </div>
      ))}
    </section>
  );
}
