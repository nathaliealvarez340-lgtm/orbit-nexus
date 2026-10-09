import type {
  CreateFiscalConsentRequest,
  CreateFiscalExtractionRequest,
  FiscalConsentPurpose,
  FiscalConsentTerms,
  FiscalDocumentConsent,
  FiscalExtractionResult,
  PrivateAssetUploadResponse,
} from "@/types/fiscal-identity";

// UI capability boundary, not a second fiscal model. Planned endpoints are not
// called until Claude publishes their implementation and integration is enabled.
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
export const issuerCsfTransport: CsfTransport = {
  async upload(file) {
    const body = new FormData();
    body.set("kind", "CSF");
    body.set("file", file);
    const response = await fetch("/api/private-assets", {
      method: "POST",
      body,
    });
    const data = await response.json();
    if (
      !response.ok ||
      typeof data.id !== "string" ||
      typeof data.fileName !== "string"
    )
      throw new Error(
        "No pudimos cargar la constancia. Revisa que sea un PDF válido de hasta 10 MB.",
      );
    return { id: data.id, fileName: data.fileName };
  },
};
// CLIENT_CSF is not supported by the current upload handler. Never send it as
// issuer CSF, which would misrepresent its purpose and permissions.
export const clientCsfTransport: CsfTransport = {};

export async function extractAuthorizedCsf(
  transport: CsfTransport,
  request: CreateFiscalConsentRequest,
): Promise<FiscalExtractionResult> {
  if (
    request.accepted !== true ||
    !request.documentId ||
    !request.consentVersion ||
    !request.privacyNoticeVersion ||
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
