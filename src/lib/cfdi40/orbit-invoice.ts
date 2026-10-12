import type {
  StampedInvoice,
  StampedInvoiceConcept,
} from "@/generated/prisma/client";
import type { OrbitInvoiceForCfdi } from "./types";

// Fase 5C.4: the only place that touches Prisma records. Decimal columns become exact
// strings (toFixed() never uses exponent notation); nothing is recomputed here.
type Decimalish = { toFixed(places?: number): string };
const text = (value: Decimalish) => value.toFixed();
const optional = (value: Decimalish | null) => (value ? value.toFixed() : null);

export function orbitInvoiceForCfdi(
  invoice: StampedInvoice & { concepts: StampedInvoiceConcept[] },
): OrbitInvoiceForCfdi {
  return {
    id: invoice.id,
    organizationId: invoice.organizationId,
    status: invoice.status,
    version: invoice.version,
    folio: invoice.folio,
    invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
    documentType: invoice.documentType,
    currency: invoice.currency,
    exchangeRate: optional(invoice.exchangeRate),
    cfdiUse: invoice.cfdiUse,
    paymentMethod: invoice.paymentMethod,
    paymentForm: invoice.paymentForm,
    exportCode: invoice.exportCode,
    // Every save or READY transition since Fase 5 stores a validation result; a null one
    // means the fiscal fields still hold migration defaults (01010101, ACT, 02, TASA, 01).
    legacyRecord: invoice.validation === null,
    issuerSnapshot: invoice.issuerSnapshot,
    receiverSnapshot: invoice.receiverSnapshot,
    totals: {
      subtotal: text(invoice.subtotal),
      discount: text(invoice.discount),
      transferred: text(invoice.tax),
      withheldVat: text(invoice.withheldVat),
      withheldIsr: text(invoice.withheldIsr),
      total: text(invoice.total),
    },
    concepts: [...invoice.concepts]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((c) => ({
        position: c.position,
        description: c.description,
        productCode: c.productCode,
        unitCode: c.unitCode,
        quantity: text(c.quantity),
        unitPrice: text(c.unitPrice),
        discount: text(c.discount),
        taxObject: c.taxObject,
        vatFactor: c.vatFactor,
        vatRate: optional(c.vatRate),
        appliedVatRate: text(c.taxRate),
        withholdingVatRate: optional(c.withholdingVatRate),
        withholdingIsrRate: optional(c.withholdingIsrRate),
        totals: {
          amount: text(c.subtotal),
          discount: text(c.discount),
          transferred: text(c.transferredTaxes),
          withheldVat: text(c.withheldVat),
          withheldIsr: text(c.withheldIsr),
        },
      })),
  };
}
