import "server-only";
import { StampServiceError } from "@/services/cfdi40-stamp";
import { InvoiceApiError, invoiceApiError } from "./invoice-api";

// Fase 5C.8: stamping routes answer { error, code, validation? } like the other Invoice Studio
// routes (src/types/stamping.ts StampErrorCode); never provider text or technical detail.
export function stampApiError(error: unknown) {
  return invoiceApiError(
    error instanceof StampServiceError
      ? new InvoiceApiError(
          error.status,
          error.message,
          error.code,
          error.validation,
        )
      : error,
  );
}
