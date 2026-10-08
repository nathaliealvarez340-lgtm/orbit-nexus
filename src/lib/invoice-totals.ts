// Browser-safe Decimal: Invoice Studio may reuse this for previews, but persisted
// totals are always recomputed here on the server (contract §16).
import { Prisma } from "@/generated/prisma/browser";
import type { InvoiceTotals } from "@/types/invoice-studio";

type Decimal = InstanceType<typeof Prisma.Decimal>;
export type InvoiceTotalsLine = {
  quantity: string;
  unitPrice: string;
  discount?: string;
  taxObject?: string;
  vatFactor?: "TASA" | "EXENTO";
  vatRate?: string;
  withholdingVatRate?: string;
  withholdingIsrRate?: string;
};
const zero = () => new Prisma.Decimal(0);

// CFDI 4.0: Importe = Cantidad x ValorUnitario; taxes apply to Base = Importe - Descuento,
// only for ObjetoImp 02. Each amount is rounded once per line to 2 decimals, then summed.
export function calculateInvoiceTotals(lines: InvoiceTotalsLine[]) {
  const sums = {
    subtotal: zero(),
    discount: zero(),
    transferredTaxes: zero(),
    withheldVat: zero(),
    withheldIsr: zero(),
  };
  const computed = lines.map((line) => {
    const subtotal = new Prisma.Decimal(line.quantity)
      .mul(line.unitPrice)
      .toDecimalPlaces(2);
    const discount = new Prisma.Decimal(line.discount || 0).toDecimalPlaces(2);
    const base = subtotal.sub(discount);
    const taxable = (line.taxObject ?? "02") === "02";
    const tax = (rate: string | undefined) =>
      taxable && rate ? base.mul(rate).toDecimalPlaces(2) : zero();
    const transferredTaxes = tax(
        (line.vatFactor ?? "TASA") === "TASA" ? line.vatRate : undefined,
      ),
      withheldVat = tax(line.withholdingVatRate),
      withheldIsr = tax(line.withholdingIsrRate);
    sums.subtotal = sums.subtotal.add(subtotal);
    sums.discount = sums.discount.add(discount);
    sums.transferredTaxes = sums.transferredTaxes.add(transferredTaxes);
    sums.withheldVat = sums.withheldVat.add(withheldVat);
    sums.withheldIsr = sums.withheldIsr.add(withheldIsr);
    const withheldTaxes = withheldVat.add(withheldIsr);
    return {
      subtotal,
      discount,
      base,
      transferredTaxes,
      withheldVat,
      withheldIsr,
      withheldTaxes,
      total: base.add(transferredTaxes).sub(withheldTaxes),
    };
  });
  const withheldTaxes = sums.withheldVat.add(sums.withheldIsr);
  return {
    ...sums,
    withheldTaxes,
    total: sums.subtotal
      .sub(sums.discount)
      .add(sums.transferredTaxes)
      .sub(withheldTaxes),
    lines: computed,
  };
}
export type CalculatedInvoiceTotals = ReturnType<typeof calculateInvoiceTotals>;

const money = (d: Decimal) => d.toFixed(2);
export function serializeInvoiceTotals(
  t: CalculatedInvoiceTotals,
): InvoiceTotals {
  return {
    subtotal: money(t.subtotal),
    discount: money(t.discount),
    transferredTaxes: money(t.transferredTaxes),
    withheldTaxes: money(t.withheldTaxes),
    total: money(t.total),
    lines: t.lines.map((l) => ({
      subtotal: money(l.subtotal),
      discount: money(l.discount),
      transferredTaxes: money(l.transferredTaxes),
      withheldTaxes: money(l.withheldTaxes),
      total: money(l.total),
    })),
  };
}

// Phase 3 shape: VAT only, no discounts or withholdings.
export function invoiceTotals(
  concepts: { quantity: string; unitPrice: string; taxRate: string }[],
) {
  const t = calculateInvoiceTotals(
    concepts.map((c) => ({ ...c, vatRate: c.taxRate })),
  );
  return {
    subtotal: t.subtotal,
    tax: t.transferredTaxes,
    total: t.total,
    lines: t.lines.map((l) => ({
      net: l.subtotal,
      tax: l.transferredTaxes,
      total: l.total,
    })),
  };
}
