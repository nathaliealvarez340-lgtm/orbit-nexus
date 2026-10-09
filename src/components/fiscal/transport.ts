import type {
  CreateFiscalConsentRequest,
  CreateFiscalExtractionRequest,
  FiscalConsentPurpose,
  FiscalConsentTerms,
  FiscalDocumentConsent,
  FiscalExtractionResult,
  PrivateAssetUploadResponse,
  FiscalCatalogVersioned,
} from "@/types/fiscal-identity";

// UI transport over the published fiscal identity APIs. Fixtures are test-only.
export type CsfTransport = {
  upload?: (file: File) => Promise<PrivateAssetUploadResponse>;
  terms?: (
    purpose: FiscalConsentPurpose,
    signal: AbortSignal,
  ) => Promise<FiscalConsentTerms>;
  consent?: (
    request: CreateFiscalConsentRequest,
  ) => Promise<FiscalDocumentConsent>;
  extract?: (
    request: CreateFiscalExtractionRequest,
  ) => Promise<FiscalExtractionResult>;
};
const errorMessages: Record<string, string> = {
  CONSENT_REQUIRED:
    "Autoriza la lectura de esta constancia antes de procesarla.",
  CONSENT_VERSION_OUTDATED:
    "La autorización cambió. Actualiza el texto, revísalo y acepta de nuevo.",
  PRIVACY_NOTICE_OUTDATED:
    "El Aviso de Privacidad cambió. Actualiza la autorización y revísala de nuevo.",
  PRIVACY_NOTICE_MISSING:
    "La lectura está bloqueada hasta publicar el Aviso de Privacidad vigente. Puedes continuar manualmente.",
  DOCUMENT_NOT_AVAILABLE:
    "La constancia ya no está disponible para esta empresa. Cárgala de nuevo.",
  DOCUMENT_NOT_SUPPORTED:
    "Solo se pueden leer Constancias de Situación Fiscal en PDF.",
  CLIENT_REQUIRED:
    "Guarda y selecciona el cliente antes de cargar su constancia.",
  CLIENT_NOT_AVAILABLE:
    "El cliente ya no está disponible o está archivado. No podemos continuar con su constancia.",
  CLIENT_NOT_ALLOWED:
    "Esta autorización no corresponde al cliente seleccionado.",
  EXTRACTION_NOT_AVAILABLE:
    "La extracción no está disponible para esta empresa. Revisa el documento y su autorización.",
  INVALID_PURPOSE: "La autorización no corresponde a esta operación.",
};
export class FiscalUiError extends Error {
  constructor(
    public code: string | undefined,
    public status: number,
    public fields: string[] = [],
  ) {
    super(
      errorMessages[code ?? ""] ??
        (fields.length
          ? `Revisa los campos indicados: ${fields.join(", ")}. El servidor rechazó los datos.`
          : status === 401
            ? "Tu sesión venció. Inicia sesión nuevamente."
            : status === 403
              ? "No tienes permiso para realizar esta operación."
              : status === 404
                ? "El recurso ya no está disponible para esta empresa."
                : status === 429
                  ? "Demasiadas solicitudes. Espera un momento antes de continuar."
                  : status === 413
                    ? "El archivo o solicitud supera el tamaño permitido."
                    : "No pudimos completar la operación. Revisa los datos o intenta nuevamente."),
    );
  }
}
const fieldLabels: Record<string, string> = {
  rfc: "RFC",
  legalName: "nombre o razón social",
  fiscalRegime: "régimen fiscal",
  cfdiUse: "Uso CFDI",
  personType: "tipo de persona",
  postalCode: "código postal",
  email: "correo",
  confirmed: "confirmación",
  extractionId: "extracción",
  csfDocumentId: "constancia",
};
export async function fiscalRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const fields =
      data?.fields && typeof data.fields === "object"
        ? Object.keys(data.fields)
            .filter(
              (key) =>
                Array.isArray(data.fields[key]) && data.fields[key].length,
            )
            .map((key) => fieldLabels[key])
            .filter(Boolean)
        : [];
    throw new FiscalUiError(
      typeof data?.code === "string" ? data.code : undefined,
      response.status,
      fields,
    );
  }
  if (!data || typeof data !== "object")
    throw new Error("Respuesta no disponible.");
  return data as T;
}
export function fiscalErrorMessage(error: unknown, fallback: string) {
  return error instanceof FiscalUiError ? error.message : fallback;
}
function createCsfTransport(kind: "CSF" | "CLIENT_CSF"): CsfTransport {
  return {
    async upload(file) {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      const data = await fiscalRequest<PrivateAssetUploadResponse>(
        "/api/private-assets",
        {
          method: "POST",
          body,
        },
      );
      if (typeof data.id !== "string" || typeof data.fileName !== "string")
        throw new Error(
          "No pudimos cargar la constancia. Revisa que sea un PDF válido de hasta 10 MB.",
        );
      return { id: data.id, fileName: data.fileName };
    },
    terms(purpose, signal) {
      return fiscalRequest<FiscalConsentTerms>(
        `/api/fiscal-consents/terms?purpose=${encodeURIComponent(purpose)}`,
        { signal },
      );
    },
    consent(request) {
      return fiscalRequest<FiscalDocumentConsent>("/api/fiscal-consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    },
    async extract(request) {
      const created = await fiscalRequest<FiscalExtractionResult>(
        "/api/fiscal-extractions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const result = await fiscalRequest<FiscalExtractionResult>(
        `/api/fiscal-extractions/${encodeURIComponent(created.id)}`,
      );
      if (result.id !== created.id)
        throw new Error("Extracción no correlacionada.");
      return result;
    },
  };
}
export const issuerCsfTransport = createCsfTransport("CSF");
export const clientCsfTransport = createCsfTransport("CLIENT_CSF");
export async function searchIdentityCatalog(
  catalog: "fiscal-regimes" | "cfdi-uses",
  query: string,
  personType: string,
  regime: string | undefined,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ q: query, personType });
  if (regime) params.set("regime", regime);
  const result = await fiscalRequest<FiscalCatalogVersioned>(
    `/api/fiscal-catalogs/${catalog}?${params}`,
    { signal },
  );
  if (result.catalog !== catalog || !Array.isArray(result.results))
    throw new Error("Catálogo no disponible.");
  return result;
}

export async function extractAuthorizedCsf(
  transport: CsfTransport,
  request: CreateFiscalConsentRequest,
): Promise<FiscalExtractionResult> {
  if (
    request.accepted !== true ||
    !request.documentId ||
    !request.consentVersion ||
    !transport.consent ||
    !transport.extract ||
    (request.purpose === "CLIENT_FISCAL_PREFILL" && !request.clientId)
  )
    throw new Error("Lectura no disponible o no autorizada.");
  const consent = await transport.consent(request);
  if (
    consent.documentId !== request.documentId ||
    consent.purpose !== request.purpose ||
    consent.clientId !== (request.clientId ?? null) ||
    consent.consentVersion !== request.consentVersion ||
    consent.privacyNoticeVersion !== request.privacyNoticeVersion
  )
    throw new Error("La autorización no corresponde a este documento.");
  const result = await transport.extract({ consentId: consent.id });
  if (
    result.documentId !== request.documentId ||
    result.consentId !== consent.id ||
    result.purpose !== request.purpose ||
    result.clientId !== (request.clientId ?? null)
  )
    throw new Error("El resultado no corresponde a este documento.");
  return result;
}
