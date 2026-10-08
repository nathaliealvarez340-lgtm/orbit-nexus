import "server-only";
import { ZodError } from "zod";
import { ApiError, apiError } from "./http";
import { buildValidationResult, issuesFromStructure } from "./invoice-rules";
import type { InvoiceValidationResult } from "@/types/invoice-studio";

// Contract §29: dedicated limit for Invoice Studio routes that accept many concepts.
export const invoiceStudioBodyLimit = 256 * 1024;

// Errors carry a stable code so Invoice Studio can tell a stale draft (DRAFT_CONFLICT)
// from other conflicts, plus the validation result when one applies.
export class InvoiceApiError extends ApiError {
  constructor(
    status: number,
    message: string,
    public code: string,
    public validation?: InvoiceValidationResult,
  ) {
    super(status, message);
  }
}

export function invoiceApiError(error: unknown) {
  if (error instanceof InvoiceApiError)
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...(error.validation ? { validation: error.validation } : {}),
      },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return Response.json(
      {
        error: "Revisa los campos indicados.",
        code: "INVALID_REQUEST",
        fields: error.flatten().fieldErrors,
        validation: buildValidationResult(issuesFromStructure(error.issues)),
      },
      { status: 400 },
    );
  return apiError(error);
}
