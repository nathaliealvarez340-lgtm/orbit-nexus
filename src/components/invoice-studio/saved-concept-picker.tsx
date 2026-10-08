import { useCallback, useRef } from "react";
import type { SavedInvoiceConcept } from "@/types/invoice-studio";
import { CatalogCombobox } from "./catalog-combobox";
import { readConcepts, studioRequest } from "./transport";

export function SavedConceptPicker({
  onSelect,
}: {
  onSelect: (concept: SavedInvoiceConcept) => void;
}) {
  const concepts = useRef<SavedInvoiceConcept[]>([]);
  const loadOptions = useCallback(
    async (query: string, signal: AbortSignal) => {
      const result = readConcepts(
        await studioRequest(
          `/api/invoice-concepts?q=${encodeURIComponent(query)}`,
          { signal },
        ),
      );
      if (!signal.aborted) concepts.current = result;
      return result
        .filter((item) => item.active)
        .map((item) => ({
          code: item.id,
          label: `${item.name} · ${item.description}`,
          active: item.active,
        }));
    },
    [],
  );
  return (
    <CatalogCombobox
      label="Agregar concepto guardado"
      showCode={false}
      loadOptions={loadOptions}
      onChange={(id) => {
        const concept = concepts.current.find((item) => item.id === id);
        if (concept) onSelect(concept);
      }}
      help="Busca por nombre, descripción o clave SAT. Se agrega una copia editable a esta factura."
    />
  );
}
