import type {
  Cfdi40DraftInput,
  Cfdi40PartyInput,
  Cfdi40ReceiverInput,
  OrbitInvoiceForCfdi,
} from "./types";

// Fase 5C.4: ORBIT vocabulary → CFDI vocabulary. No computation, defaults or validation:
// a missing value stays null so the normalizer reports it instead of inventing it.
// Issuer and receiver come only from the fiscal snapshots stored with the draft
// (contract §11); display names, emails or trade names are never used.

const field = (snapshot: unknown, key: string) => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : null;
};
const party = (snapshot: unknown): Cfdi40PartyInput => ({
  rfc: field(snapshot, "rfc"),
  name: field(snapshot, "legalName"),
  personType: field(snapshot, "personType"),
  fiscalRegime: field(snapshot, "fiscalRegime"),
  postalCode: field(snapshot, "postalCode"),
});

export function mapOrbitInvoice(
  invoice: OrbitInvoiceForCfdi,
): Cfdi40DraftInput {
  const receiver: Cfdi40ReceiverInput = {
    ...party(invoice.receiverSnapshot),
    // The Uso CFDI chosen for this invoice, not the client's default.
    cfdiUse: invoice.cfdiUse,
    country: field(invoice.receiverSnapshot, "country"),
    foreignTaxId: field(invoice.receiverSnapshot, "foreignTaxId"),
  };
  return {
    invoiceId: invoice.id,
    status: invoice.status,
    documentType: invoice.documentType,
    // ORBIT folios already carry the configured prefix ("ORB-000123"); no Serie is split.
    serie: null,
    folio: invoice.folio,
    draftDate: invoice.invoiceDate,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate,
    paymentForm: invoice.paymentForm,
    paymentMethod: invoice.paymentMethod,
    exportCode: invoice.exportCode,
    legacyRecord: invoice.legacyRecord,
    issuer: party(invoice.issuerSnapshot),
    receiver,
    concepts: invoice.concepts.map((c, index) => ({
      index,
      productCode: c.productCode,
      unitCode: c.unitCode,
      description: c.description,
      quantity: c.quantity,
      unitPrice: c.unitPrice,
      discount: c.discount,
      taxObject: c.taxObject,
      vat:
        c.vatFactor === "EXENTO"
          ? { factor: "Exento", rate: c.vatRate }
          : { factor: "Tasa", rate: c.vatRate },
      withholdingVatRate: c.withholdingVatRate,
      withholdingIsrRate: c.withholdingIsrRate,
      orbit: { ...c.totals, appliedVatRate: c.appliedVatRate },
    })),
    // ORBIT has no CfdiRelacionados yet.
    relatedDocuments: [],
    orbitTotals: invoice.totals,
  };
}
