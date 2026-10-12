import type {
  LegalAcceptanceRequest,
  LegalAcceptanceState,
} from "@/types/legal";
import { safeFormError } from "@/lib/form-errors";

export class LegalUiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requiresReview = false,
  ) {
    super(message);
  }
}

async function legalResponse(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      body && typeof body === "object" && "code" in body ? body.code : null;
    const review = response.status === 409;
    const message =
      code === "LEGAL_DOCUMENT_NOT_PUBLISHED"
        ? "Este documento aún no está vigente y no puede aceptarse."
        : code === "LEGAL_VERSION_OUTDATED"
          ? "El documento cambió. Revisa la versión vigente antes de aceptarla."
          : review
            ? "Revisa el documento vigente antes de volver a intentarlo."
            : safeFormError(
                body,
                "No pudimos confirmar la aceptación. Consulta de nuevo su estado.",
              );
    throw new LegalUiError(message, response.status, review);
  }
  return body;
}

export async function readLegalAcceptances(
  signal?: AbortSignal,
): Promise<LegalAcceptanceState[]> {
  const body = await legalResponse(
    await fetch("/api/legal/acceptances", {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    }),
  );
  if (
    !Array.isArray(body) ||
    !body.every(
      (state) =>
        state &&
        ["TERMS", "PRIVACY_NOTICE"].includes(state.document) &&
        ["DRAFT", "PUBLISHED"].includes(state.status) &&
        typeof state.version === "string" &&
        typeof state.contentHash === "string" &&
        typeof state.acceptable === "boolean" &&
        typeof state.accepted === "boolean" &&
        (state.acceptedAt === null ||
          (typeof state.acceptedAt === "string" &&
            Number.isFinite(Date.parse(state.acceptedAt)))),
    )
  )
    throw new LegalUiError(
      "No pudimos consultar el estado de aceptación.",
      503,
    );
  return body;
}

export async function submitLegalAcceptance(
  input: LegalAcceptanceRequest,
  signal?: AbortSignal,
) {
  const body = await legalResponse(
    await fetch("/api/legal/acceptances", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  if (
    !body ||
    typeof body !== "object" ||
    !("document" in body) ||
    !("version" in body) ||
    !("contentHash" in body) ||
    !("acceptedAt" in body) ||
    body.document !== input.document ||
    body.version !== input.version ||
    body.contentHash !== input.contentHash ||
    typeof body.acceptedAt !== "string" ||
    !Number.isFinite(Date.parse(body.acceptedAt))
  ) {
    throw new LegalUiError(
      "No pudimos confirmar la aceptación. Consulta de nuevo su estado.",
      503,
    );
  }
  return body.acceptedAt;
}
