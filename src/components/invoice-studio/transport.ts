import type {
  CatalogOption,
  InvoiceStudioContext,
  CreateInvoiceDraftResponse,
} from "@/types/invoice-studio";
import type { DraftDetail, Evaluation } from "./model";

export class StudioRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: Evaluation["validation"]["issues"],
  ) {
    super(message);
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
    const body = record(value),
      validation = record(body.validation);
    throw new StudioRequestError(
      response.status === 404 || response.status === 405
        ? "Esta función todavía no está disponible. Tu captura permanece en esta pantalla."
        : typeof body.error === "string"
          ? body.error
          : "No pudimos completar la operación. Intenta nuevamente.",
      response.status,
      Array.isArray(validation.issues)
        ? (validation.issues as Evaluation["validation"]["issues"])
        : undefined,
    );
  }
  return value;
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
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
    throw pendingContract();
  return value as InvoiceStudioContext;
}
export function readEvaluation(value: unknown): Evaluation {
  const dto = record(value),
    totals = record(dto.totals),
    validation = record(dto.validation);
  if (
    ![
      "subtotal",
      "discount",
      "transferredTaxes",
      "withheldTaxes",
      "total",
    ].every((key) => typeof totals[key] === "string") ||
    !Array.isArray(totals.lines) ||
    typeof validation.valid !== "boolean" ||
    typeof validation.canMarkReady !== "boolean" ||
    !Array.isArray(validation.issues) ||
    !["issuer", "receiver", "document", "payment", "concepts", "totals"].every(
      (key) =>
        ["OK", "WARNING", "ERROR"].includes(
          String(record(validation.sections)[key]),
        ),
    )
  )
    throw pendingContract();
  return value as Evaluation;
}
export function readSaved(value: unknown): CreateInvoiceDraftResponse {
  readEvaluation(value);
  const dto = record(value);
  if (
    typeof dto.id !== "string" ||
    typeof dto.updatedAt !== "string" ||
    !["DRAFT", "READY"].includes(String(dto.status))
  )
    throw pendingContract();
  return value as CreateInvoiceDraftResponse;
}
export function readDetail(value: unknown): DraftDetail {
  readSaved(value);
  const dto = record(value);
  if (
    !Array.isArray(dto.concepts) ||
    !dto.issuerSnapshot ||
    !dto.receiverSnapshot ||
    ![
      "clientId",
      "invoiceDate",
      "documentType",
      "currency",
      "cfdiUse",
      "exportCode",
    ].every((key) => typeof dto[key] === "string")
  )
    throw pendingContract();
  return value as DraftDetail;
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
    throw pendingContract();
  return value as CatalogOption[];
}
function pendingContract() {
  return new StudioRequestError(
    "Esta función está pendiente de integración. No podemos confirmar sus datos todavía.",
    503,
  );
}
