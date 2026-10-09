"use client";
import { CatalogCombobox } from "@/components/invoice-studio/catalog-combobox";
import type { InvoiceFiscalCatalogs } from "@/types/invoice-studio";
import type { FiscalCatalogVersioned } from "@/types/fiscal-identity";
import { useCallback, useState } from "react";
import { searchIdentityCatalog } from "./transport";
export function FiscalCatalogFields({
  catalogs,
  regime,
  cfdiUse,
  onRegime,
  onUse,
  disabled = false,
  issuer = false,
  personType,
}: {
  catalogs?: Pick<InvoiceFiscalCatalogs, "fiscalRegimes" | "cfdiUses">;
  personType: string;
  regime: string;
  cfdiUse: string;
  onRegime: (code: string) => void;
  onUse: (code: string) => void;
  disabled?: boolean;
  issuer?: boolean;
}) {
  const [source, setSource] = useState<FiscalCatalogVersioned>();
  const loadRegimes = useCallback(
    async (query: string, signal: AbortSignal) => {
      const data = await searchIdentityCatalog(
        "fiscal-regimes",
        query,
        personType,
        undefined,
        signal,
      );
      if (!signal.aborted) setSource(data);
      return data.results;
    },
    [personType],
  );
  const loadUses = useCallback(
    async (query: string, signal: AbortSignal) => {
      const data = await searchIdentityCatalog(
        "cfdi-uses",
        query,
        personType,
        regime,
        signal,
      );
      return data.results;
    },
    [personType, regime],
  );
  return (
    <>
      <CatalogCombobox
        key={`regime:${personType}`}
        label="Régimen fiscal"
        name="fiscalRegime"
        value={regime}
        options={catalogs?.fiscalRegimes}
        loadOptions={catalogs ? undefined : loadRegimes}
        onChange={onRegime}
        disabled={disabled}
        help="Selecciona una clave del catálogo. El backend valida la combinación fiscal."
      />
      <CatalogCombobox
        key={`use:${personType}:${regime}`}
        label={issuer ? "Uso CFDI predeterminado" : "Uso CFDI"}
        name="cfdiUse"
        value={cfdiUse}
        options={catalogs?.cfdiUses}
        loadOptions={catalogs ? undefined : loadUses}
        onChange={onUse}
        disabled={disabled}
        help="Elige el uso por separado; la Constancia no lo determina."
      />
      <p className="fiscal-pending md:col-span-2">
        {source
          ? `Fuente del servidor: ${source.source === "SAT_OFFICIAL" ? "SAT oficial" : "cobertura parcial"} · Versión ${source.version ?? "no disponible"}.`
          : "Los catálogos se consultan en el servidor."}{" "}
        El servidor filtra compatibilidad y decide la validez de los datos;
        seleccionar una clave no verifica al contribuyente ante el SAT.
      </p>
    </>
  );
}
