"use client";
import { CatalogCombobox } from "@/components/invoice-studio/catalog-combobox";
import type { InvoiceFiscalCatalogs } from "@/types/invoice-studio";
export function FiscalCatalogFields({
  catalogs,
  regime,
  cfdiUse,
  onRegime,
  onUse,
  disabled = false,
  issuer = false,
}: {
  catalogs: Pick<InvoiceFiscalCatalogs, "fiscalRegimes" | "cfdiUses">;
  regime: string;
  cfdiUse: string;
  onRegime: (code: string) => void;
  onUse: (code: string) => void;
  disabled?: boolean;
  issuer?: boolean;
}) {
  return (
    <>
      <CatalogCombobox
        label="Régimen fiscal"
        name="fiscalRegime"
        value={regime}
        options={catalogs.fiscalRegimes}
        onChange={onRegime}
        disabled={disabled}
        help="Selecciona una clave del catálogo. El backend valida la combinación fiscal."
      />
      <CatalogCombobox
        label={issuer ? "Uso CFDI predeterminado" : "Uso CFDI"}
        name="cfdiUse"
        value={cfdiUse}
        options={catalogs.cfdiUses}
        onChange={onUse}
        disabled={disabled}
        help="Elige el uso por separado; la Constancia no lo determina."
      />
      <p className="fiscal-pending md:col-span-2">
        Fuente actual: catálogo compartido de ORBIT servido por esta página. Su
        versión oficial y la búsqueda con compatibilidad fiscal están pendientes
        del backend. No representa una validación del SAT.
      </p>
    </>
  );
}
