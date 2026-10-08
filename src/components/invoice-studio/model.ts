import type {
  CatalogOption,
  CreateInvoiceDraftRequest,
  CreateInvoiceDraftResponse,
  InvoiceStudioContext,
  InvoiceStudioClient,
  InvoiceValidationIssue,
  SavedInvoiceConcept,
} from "@/types/invoice-studio";

// UI projection of section 26. The definitive detail DTO belongs to Claude.
export type DraftDetail = CreateInvoiceDraftRequest &
  CreateInvoiceDraftResponse & {
    issuerSnapshot: InvoiceStudioContext["issuer"];
    receiverSnapshot: InvoiceStudioClient;
  };
export type Evaluation = Pick<
  CreateInvoiceDraftResponse,
  "totals" | "validation"
>;
export const sectionLabels = {
  issuer: "Emisor",
  receiver: "Receptor",
  document: "Comprobante",
  payment: "Datos de pago",
  concepts: "Conceptos",
  totals: "Totales",
} as const;
export function newConcept(): CreateInvoiceDraftRequest["concepts"][number] {
  return {
    description: "",
    productCode: "",
    unitCode: "",
    quantity: "1",
    unitPrice: "",
    discount: "",
    taxObject: "",
    vatFactor: "TASA",
    vatRate: "",
    withholdingVatRate: "",
    withholdingIsrRate: "",
  };
}
export function newDraft(
  context: InvoiceStudioContext,
): CreateInvoiceDraftRequest {
  return {
    clientId: "",
    invoiceDate: new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Mexico_City",
    }),
    documentType: "I",
    currency: context.settings.currencyDefault,
    cfdiUse: "",
    paymentMethod: context.settings.paymentMethodDefault,
    paymentForm: context.settings.paymentFormDefault,
    exportCode: "",
    concepts: [newConcept()],
  };
}
export function conceptSnapshot(
  concept: SavedInvoiceConcept,
): CreateInvoiceDraftRequest["concepts"][number] {
  return {
    savedConceptId: concept.id,
    description: concept.description,
    productCode: concept.productCode,
    unitCode: concept.unitCode,
    quantity: concept.defaultQuantity ?? "1",
    unitPrice: concept.unitPrice ?? "",
    taxObject: concept.taxObject,
    vatFactor: concept.vatFactor,
    vatRate: concept.vatRate,
    withholdingVatRate: concept.withholdingVatRate,
    withholdingIsrRate: concept.withholdingIsrRate,
  };
}
export function draftRequest(detail: DraftDetail): CreateInvoiceDraftRequest {
  // Explicit whitelist: never send issuer, organizationId, status, folio or totals.
  return {
    clientId: detail.clientId,
    invoiceDate: detail.invoiceDate,
    documentType: detail.documentType,
    currency: detail.currency,
    exchangeRate: detail.exchangeRate,
    cfdiUse: detail.cfdiUse,
    paymentMethod: detail.paymentMethod,
    paymentForm: detail.paymentForm,
    exportCode: detail.exportCode,
    concepts: detail.concepts.map((line) => ({
      savedConceptId: line.savedConceptId,
      description: line.description,
      productCode: line.productCode,
      unitCode: line.unitCode,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      taxObject: line.taxObject,
      vatFactor: line.vatFactor,
      vatRate: line.vatRate,
      withholdingVatRate: line.withholdingVatRate,
      withholdingIsrRate: line.withholdingIsrRate,
    })),
  };
}
export function catalogLabel(options: CatalogOption[], value?: string) {
  if (!value) return "Sin seleccionar";
  const option = options.find((item) => item.code === value);
  return option
    ? `${option.code} · ${option.label}`
    : `${value} · Pendiente de verificar`;
}
export function formatAmount(value: string | undefined, currency = "") {
  if (!value || !/^-?\d+(\.\d+)?$/.test(value)) return "—";
  const [integer, fraction = ""] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")} ${currency}`.trim();
}
// Presentation conversion only. Decimal strings are shifted, never calculated using floats.
export function shiftDecimal(value: string, places: number) {
  if (!value) return "";
  if (!/^\d*(\.\d*)?$/.test(value) || value === ".") return value;
  const [whole = "", fraction = ""] = value.split(".");
  const digits = whole + fraction,
    point = whole.length + places;
  const shifted =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : digits.slice(0, point) + "." + digits.slice(point);
  const [left, right = ""] = shifted.split(".");
  const decimal = right.replace(/0+$/, "");
  return (
    (left.replace(/^0+(?=\d)/, "") || "0") + (decimal ? "." + decimal : "")
  );
}
export function issueTarget(issue: InvoiceValidationIssue) {
  const matched = issue.field?.match(/^concepts(?:\[(\d+)\]|\.(\d+))\.(.+)$/);
  return {
    field: matched?.[3] ?? issue.field,
    index:
      issue.conceptIndex ??
      (matched ? Number(matched[1] ?? matched[2]) : undefined),
  };
}
