import type {
  CatalogOption,
  InvoiceStudioContext,
  CreateInvoiceDraftResponse,
  InvoiceDraftDetail,
  InvoiceValidationResult,
  ValidateInvoiceDraftResponse,
  FiscalCatalogSearchResponse,
  SavedInvoiceConcept,
} from "@/types/invoice-studio";

export class StudioRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public validation?: InvoiceValidationResult,
  ) {
    super(message);
  }
  get issues() {
    return this.validation?.issues;
  }
}
export async function studioRequest(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = record(value);
    throw new StudioRequestError(
      typeof body.error === "string"
        ? body.error
        : "No pudimos completar la operación. Tu captura permanece en esta pantalla.",
      response.status,
      typeof body.code === "string" ? body.code : undefined,
      body.validation ? readValidation(body.validation) : undefined,
    );
  }
  return value;
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function invalidResponse(): never {
  throw new StudioRequestError(
    "No pudimos verificar la respuesta del servidor. Conservamos tu captura; vuelve a cargar el documento para revisarlo.",
    502,
    "INVALID_RESPONSE",
  );
}
function readValidation(value: unknown): InvoiceValidationResult {
  const dto = record(value);
  if (
    typeof dto.valid !== "boolean" ||
    typeof dto.canMarkReady !== "boolean" ||
    !Array.isArray(dto.issues) ||
    !["issuer", "receiver", "document", "payment", "concepts", "totals"].every(
      (key) =>
        ["OK", "WARNING", "ERROR"].includes(String(record(dto.sections)[key])),
    )
  )
    invalidResponse();
  return value as InvoiceValidationResult;
}
export function readContext(value: unknown): InvoiceStudioContext {
  const dto = record(value);
  if (
    !dto.issuer ||
    !dto.settings ||
    !Array.isArray(dto.clients) ||
    !Array.isArray(dto.savedConcepts) ||
    ![
      "documentTypes",
      "paymentMethods",
      "paymentForms",
      "cfdiUses",
      "fiscalRegimes",
      "currencies",
      "taxObjects",
      "exportCodes",
    ].every((key) => Array.isArray(record(dto.catalogs)[key]))
  )
    invalidResponse();
  return value as InvoiceStudioContext;
}
export function readEvaluation(value: unknown): ValidateInvoiceDraftResponse {
  const dto = record(value),
    totals = record(dto.totals);
  readValidation(dto.validation);
  if (
    dto.totals !== null &&
    (![
      "subtotal",
      "discount",
      "transferredTaxes",
      "withheldTaxes",
      "total",
    ].every((key) => typeof totals[key] === "string") ||
      !Array.isArray(totals.lines))
  )
    invalidResponse();
  return value as ValidateInvoiceDraftResponse;
}
export function readSaved(value: unknown): CreateInvoiceDraftResponse {
  readEvaluation(value);
  const dto = record(value);
  if (
    dto.totals === null ||
    typeof dto.id !== "string" ||
    typeof dto.updatedAt !== "string" ||
    !(dto.folio === null || typeof dto.folio === "string") ||
    !["DRAFT", "READY"].includes(String(dto.status))
  )
    invalidResponse();
  return value as CreateInvoiceDraftResponse;
}
export function readDetail(value: unknown): InvoiceDraftDetail {
  const dto = record(value);
  if (!["DRAFT", "READY"].includes(String(dto.status)))
    throw new StudioRequestError(
      "Solo los borradores pueden editarse en Invoice Studio.",
      409,
      "INVOICE_NOT_EDITABLE",
    );
  readSaved(value);
  if (
    !Array.isArray(dto.concepts) ||
    !["clientId", "invoiceDate", "cfdiUse"].every(
      (key) => dto[key] === null || typeof dto[key] === "string",
    ) ||
    !["documentType", "currency", "exportCode"].every(
      (key) => typeof dto[key] === "string",
    ) ||
    !["issuerSnapshot", "receiverSnapshot"].every(
      (key) => dto[key] === null || typeof dto[key] === "object",
    )
  )
    invalidResponse();
  return value as InvoiceDraftDetail;
}
export function readOptions(value: unknown): CatalogOption[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => {
      const option = record(item);
      return (
        typeof option.code === "string" &&
        typeof option.label === "string" &&
        typeof option.active === "boolean"
      );
    })
  )
    invalidResponse();
  return value as CatalogOption[];
}
export function readCatalog(value: unknown): FiscalCatalogSearchResponse {
  const dto = record(value);
  readOptions(dto.results);
  if (
    typeof dto.catalog !== "string" ||
    typeof dto.complete !== "boolean" ||
    !["CURATED_SUBSET", "SAT_OFFICIAL"].includes(String(dto.source))
  )
    invalidResponse();
  return value as FiscalCatalogSearchResponse;
}
export function readConcepts(value: unknown): SavedInvoiceConcept[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => {
      const dto = record(item);
      return (
        [
          "id",
          "name",
          "description",
          "productCode",
          "unitCode",
          "taxObject",
        ].every((key) => typeof dto[key] === "string") &&
        ["TASA", "EXENTO"].includes(String(dto.vatFactor)) &&
        typeof dto.active === "boolean"
      );
    })
  )
    invalidResponse();
  return value as SavedInvoiceConcept[];
}
