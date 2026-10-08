import type { InvoiceTotals } from "@/types/invoice-studio";
import { useId } from "react";
import { formatAmount } from "./model";

export function TotalsSummary({
  totals,
  currency,
  busy,
}: {
  totals?: InvoiceTotals;
  currency: string;
  busy?: boolean;
}) {
  const title = useId();
  return (
    <section className="studio-card p-5" aria-labelledby={title}>
      <div className="flex justify-between gap-3">
        <h2 id={title} className="font-semibold">
          Resumen de importes
        </h2>
        <span className="font-mono text-xs text-zinc-400">{currency}</span>
      </div>
      <dl className="studio-totals mt-5">
        {(
          [
            ["subtotal", "Subtotal"],
            ["discount", "Descuentos"],
            ["transferredTaxes", "Impuestos trasladados"],
            ["withheldTaxes", "Impuestos retenidos"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{formatAmount(totals?.[key])}</dd>
          </div>
        ))}
        <div className="studio-grand-total">
          <dt>Total</dt>
          <dd>{formatAmount(totals?.total)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-5 text-zinc-400">
        {busy
          ? "Actualizando importes…"
          : totals
            ? "Importes calculados por el servidor. Documento aún no timbrado."
            : "Los importes aparecerán después de validar tus conceptos."}
      </p>
    </section>
  );
}
