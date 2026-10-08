import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  InvoiceDraftConcept,
  InvoiceStudioContext,
  InvoiceTotals,
} from "@/types/invoice-studio";
import { Button } from "@/components/ui/button";
import { CatalogCombobox } from "./catalog-combobox";
import { SavedConceptPicker } from "./saved-concept-picker";
import {
  PercentField,
  StudioField,
  StudioSection,
  StudioSelect,
} from "./fields";
import {
  conceptSnapshot,
  formatAmount,
  newConcept,
  shiftDecimal,
} from "./model";

export function ConceptEditor({
  context,
  concepts,
  keys,
  totals,
  currency,
  onChange,
  onKeysChange,
  errorFor,
}: {
  context: InvoiceStudioContext;
  concepts: InvoiceDraftConcept[];
  keys: string[];
  totals?: InvoiceTotals;
  currency: string;
  onChange: (concepts: InvoiceDraftConcept[]) => void;
  onKeysChange: (keys: string[]) => void;
  errorFor: (field: string, index: number) => string | undefined;
}) {
  const serial = useRef(0),
    container = useRef<HTMLDivElement>(null);
  function update(
    index: number,
    field: keyof InvoiceDraftConcept,
    value: string,
  ) {
    onChange(
      concepts.map((line, i) =>
        i === index
          ? {
              ...line,
              [field]: value,
              ...(field === "vatFactor" && value === "EXENTO"
                ? { vatRate: undefined }
                : {}),
            }
          : line,
      ),
    );
  }
  function append(line = newConcept()) {
    const key = `added-${serial.current++}`;
    onKeysChange([...keys, key]);
    onChange([...concepts, line]);
    requestAnimationFrame(() =>
      container.current
        ?.querySelector<HTMLInputElement>(`[data-line-key="${key}"] input`)
        ?.focus(),
    );
  }
  return (
    <StudioSection
      id="studio-concepts"
      step="05"
      title="Conceptos"
      copy="Productos y servicios de esta factura. Editar una línea conserva el concepto original del catálogo."
    >
      <div className="studio-field-grid mb-5">
        <SavedConceptPicker
          onSelect={(concept) => {
            if (concepts.length < 100) append(conceptSnapshot(concept));
          }}
        />
      </div>
      <div ref={container} className="space-y-4">
        {concepts.map((line, index) => (
          <fieldset
            className="studio-concept"
            key={keys[index]}
            data-line-key={keys[index]}
          >
            <legend className="px-2 text-sm font-medium">
              Concepto {index + 1}
            </legend>
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="studio-help">
                {line.savedConceptId
                  ? "Copia del catálogo · Editable"
                  : "Concepto manual"}
              </span>
              <button
                type="button"
                className="studio-remove"
                disabled={concepts.length === 1}
                aria-label={`Eliminar concepto ${index + 1}`}
                title={
                  concepts.length === 1
                    ? "Conserva al menos un concepto"
                    : "Eliminar concepto"
                }
                onClick={() => {
                  onKeysChange(keys.filter((_, i) => i !== index));
                  onChange(concepts.filter((_, i) => i !== index));
                  requestAnimationFrame(() =>
                    container.current
                      ?.querySelector<HTMLInputElement>(
                        `[data-line-key="${keys[index > 0 ? index - 1 : 1]}"] input`,
                      )
                      ?.focus(),
                  );
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                <span>Eliminar</span>
              </button>
            </div>
            <StudioField
              label={`Descripción · Concepto ${index + 1}`}
              field="description"
              conceptIndex={index}
              value={line.description}
              maxLength={500}
              onChange={(value) => update(index, "description", value)}
              error={errorFor("description", index)}
            />
            <div className="studio-field-grid mt-4">
              <CatalogCombobox
                label={`Clave producto/servicio · Concepto ${index + 1}`}
                field="productCode"
                conceptIndex={index}
                value={line.productCode}
                endpoint="/api/fiscal-catalogs/product-services"
                onChange={(value) => update(index, "productCode", value)}
                error={errorFor("productCode", index)}
                help="La cobertura y validez de la clave se verifican en servidor."
              />
              <CatalogCombobox
                label={`Unidad · Concepto ${index + 1}`}
                field="unitCode"
                conceptIndex={index}
                value={line.unitCode}
                endpoint="/api/fiscal-catalogs/units"
                onChange={(value) => update(index, "unitCode", value)}
                error={errorFor("unitCode", index)}
              />
            </div>
            <div className="studio-line-amounts mt-4">
              {(
                [
                  ["quantity", "Cantidad"],
                  ["unitPrice", "Precio unitario"],
                  ["discount", "Descuento"],
                ] as const
              ).map(([field, label]) => (
                <StudioField
                  key={field}
                  label={`${label} · Concepto ${index + 1}`}
                  field={field}
                  conceptIndex={index}
                  inputMode="decimal"
                  maxLength={24}
                  value={line[field]}
                  onChange={(value) => update(index, field, value)}
                  error={errorFor(field, index)}
                />
              ))}
            </div>
            <details
              className="studio-tax-details mt-4"
              open={
                !![
                  "taxObject",
                  "vatFactor",
                  "vatRate",
                  "withholdingVatRate",
                  "withholdingIsrRate",
                ].some((field) => errorFor(field, index)) || undefined
              }
            >
              <summary>
                Impuestos y retenciones
                {line.vatFactor === "EXENTO"
                  ? " · IVA exento"
                  : line.vatRate
                    ? ` · IVA ${shiftDecimal(line.vatRate, 2)}%`
                    : " · Pendiente"}
              </summary>
              <div className="studio-field-grid mt-4">
                <StudioSelect
                  label={`Objeto de impuesto · Concepto ${index + 1}`}
                  field="taxObject"
                  conceptIndex={index}
                  value={line.taxObject}
                  options={context.catalogs.taxObjects}
                  onChange={(value) => update(index, "taxObject", value)}
                  error={errorFor("taxObject", index)}
                />
                <StudioSelect
                  label={`Tratamiento IVA · Concepto ${index + 1}`}
                  field="vatFactor"
                  conceptIndex={index}
                  value={line.vatFactor}
                  options={[
                    { code: "TASA", label: "Tasa", active: true },
                    { code: "EXENTO", label: "Exento", active: true },
                  ]}
                  onChange={(value) => update(index, "vatFactor", value)}
                  error={errorFor("vatFactor", index)}
                />
                {(
                  [
                    ["vatRate", "IVA"],
                    ["withholdingVatRate", "Retención IVA"],
                    ["withholdingIsrRate", "Retención ISR"],
                  ] as const
                )
                  .filter(
                    ([field]) =>
                      field !== "vatRate" || line.vatFactor !== "EXENTO",
                  )
                  .map(([field, label]) => (
                    <PercentField
                      key={field}
                      label={`${label} · Concepto ${index + 1}`}
                      field={field}
                      conceptIndex={index}
                      suffix="%"
                      inputMode="decimal"
                      maxLength={16}
                      value={line[field]}
                      onChange={(value) => update(index, field, value)}
                      error={errorFor(field, index)}
                    />
                  ))}
              </div>
            </details>
            <div className="mt-4 flex justify-between gap-3 border-t border-white/10 pt-4 text-sm">
              <span className="text-zinc-400">Importe con impuestos</span>
              <span className="font-mono">
                {formatAmount(totals?.lines[index]?.total, currency)}
              </span>
            </div>
          </fieldset>
        ))}
      </div>
      <Button
        variant="secondary"
        className="mt-5"
        disabled={concepts.length >= 100}
        onClick={() => append()}
      >
        <Plus className="size-4" aria-hidden="true" />
        Agregar concepto
      </Button>
      {concepts.length >= 100 && (
        <p className="studio-help mt-2">
          Máximo de 100 conceptos por borrador.
        </p>
      )}
    </StudioSection>
  );
}
