// Synthetic data exclusively for isolated UI tests; never imported by src/.
import type {
  FiscalExtractionResult,
  FiscalExtractionFieldKey,
  FiscalDocumentConsent,
  CreateFiscalConsentRequest,
} from "../src/types/fiscal-identity";
export const consentRequest: CreateFiscalConsentRequest = {
  documentId: "test-document",
  purpose: "FISCAL_PROFILE_PREFILL",
  accepted: true,
  consentVersion: "test-terms",
  privacyNoticeVersion: "test-privacy",
};
export const consent: FiscalDocumentConsent = {
  ...consentRequest,
  id: "test-consent",
  organizationId: "test-organization",
  userId: "test-user",
  clientId: null,
  acceptedAt: "2026-01-01T12:00:00Z",
};
const keys: FiscalExtractionFieldKey[] = [
  "rfc",
  "legalName",
  "personType",
  "postalCode",
  "street",
  "exteriorNumber",
  "interiorNumber",
  "colony",
  "locality",
  "municipality",
  "state",
  "country",
  "operationsStartDate",
];
export const extraction: FiscalExtractionResult = {
  id: "test-extraction",
  documentId: consent.documentId,
  consentId: consent.id,
  purpose: consent.purpose,
  clientId: null,
  status: "PARTIAL",
  parserVersion: "test-only",
  message: null,
  createdAt: consent.acceptedAt,
  fields: {
    ...(Object.fromEntries(
      keys.map((key) => [key, { value: null, status: "NOT_FOUND" }]),
    ) as FiscalExtractionResult["fields"]),
    rfc: { value: "AAA010101AAA", status: "DETECTED" },
    legalName: {
      value: "Nombre detectado de prueba",
      status: "LOW_CONFIDENCE",
      confidence: 0.4,
    },
    postalCode: {
      value: null,
      status: "AMBIGUOUS",
      candidates: ["06000", "06010"],
    },
  },
  regimes: [
    {
      code: "601",
      label: "Régimen de prueba A",
      startDate: null,
      endDate: null,
      status: "DETECTED",
      catalogVerified: true,
    },
    {
      code: "603",
      label: "Régimen de prueba B",
      startDate: null,
      endDate: null,
      status: "LOW_CONFIDENCE",
      catalogVerified: false,
    },
  ],
  comparison: [
    { field: "fiscalRegime", current: "601", detected: "555", changed: true },
    {
      field: "legalName",
      current: "Nombre actual de prueba",
      detected: "Nombre detectado de prueba",
      changed: true,
    },
  ],
};
