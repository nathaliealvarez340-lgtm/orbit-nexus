// Fase 5C shared contract: fiscal identity, CSF consent/extraction and CSD metadata
// (docs/tasks/FASE5C-CONTRACT.md §6-13). Not server-only: types only, no runtime values.
// Organization and user are always derived server-side from the session/membership;
// request types never carry them as authority. No secret ever appears in these DTOs.
import type { FiscalCatalogSearchResponse } from "./invoice-studio";

export type PersonType = "INDIVIDUAL" | "COMPANY";

// ---------------------------------------------------------------------------
// Catalogs (§7, §10.2, §10.6). Codes are persisted; labels are presentation.
// Planned routes (Bloque 1, not implemented yet; existing route is reused):
//   GET /api/fiscal-catalogs/fiscal-regimes?q=&personType=
//   GET /api/fiscal-catalogs/cfdi-uses?q=&personType=&regime=
// The backend filters compatibility; the frontend never keeps its own full copy.

/** complete stays false until the official SAT resource is imported and verified. */
export type FiscalCatalogVersioned = FiscalCatalogSearchResponse & {
  /** Version from the SAT resource manifest; null while the source is not official. */
  version: string | null;
  /** ISO date the official resource was obtained; null while the source is not official. */
  obtainedAt: string | null;
};

// ---------------------------------------------------------------------------
// Consent (§9). Upload, consent, extraction and confirmation are separate steps.

export type FiscalConsentPurpose =
  | "FISCAL_PROFILE_PREFILL"
  | "CLIENT_FISCAL_PREFILL";

/** GET /api/fiscal-consents/terms?purpose= (planned). Text is served by the backend. */
export type FiscalConsentTerms = {
  purpose: FiscalConsentPurpose;
  consentVersion: string;
  /** null while no valid Privacy Notice exists; production remains blocked (D12). */
  privacyNoticeVersion: string | null;
  text: string;
};

/** POST /api/fiscal-consents (planned) → 201 FiscalDocumentConsent. */
export type CreateFiscalConsentRequest = {
  /** Document returned by the private upload; resolved inside the active Organization. */
  documentId: string;
  purpose: FiscalConsentPurpose;
  /** Required for CLIENT_FISCAL_PREFILL; resolved inside the active Organization. */
  clientId?: string;
  /** The checkbox starts unchecked; only an explicit acceptance is valid. */
  accepted: true;
  consentVersion: string;
  privacyNoticeVersion: string | null;
};

/** Read-only evidence of an accepted consent (§9.2). Never stores document contents. */
export type FiscalDocumentConsent = {
  id: string;
  /** Derived from the session; informational only. */
  organizationId: string;
  /** Derived from the session; informational only. */
  userId: string;
  documentId: string;
  purpose: FiscalConsentPurpose;
  clientId: string | null;
  consentVersion: string;
  privacyNoticeVersion: string | null;
  acceptedAt: string;
};

/**
 * Existing POST /api/private-assets (multipart { kind, file }).
 * kind "CSF" exists today; "CLIENT_CSF" is planned. Uploading stores the
 * document privately and never triggers extraction by itself (D11).
 */
export type PrivateAssetUploadResponse = { id: string; fileName: string };

// ---------------------------------------------------------------------------
// Extraction (§8). Original document → detected data → user-confirmed data.
// Detected data is never a source for stamping and never auto-confirmed.

export type ExtractedFiscalFieldStatus =
  | "DETECTED"
  | "LOW_CONFIDENCE"
  | "AMBIGUOUS"
  | "NOT_FOUND";

export type ExtractedFiscalField = {
  /** null when the document does not contain it: pending capture, never invented. */
  value: string | null;
  status: ExtractedFiscalFieldStatus;
  /** 0..1 heuristic score; not a verified accuracy claim (D16). */
  confidence?: number;
  /** Parser hint of where the value was read (label/section), no document contents. */
  source?: string;
  /** Present when status is AMBIGUOUS. */
  candidates?: string[];
};

/** Fields the parser may detect. Uso CFDI, payment data, currency, email and phone are never inferred (§8.3). */
export type FiscalExtractionFieldKey =
  | "rfc"
  | "legalName"
  | "personType"
  | "postalCode"
  | "street"
  | "exteriorNumber"
  | "interiorNumber"
  | "colony"
  | "locality"
  | "municipality"
  | "state"
  | "country"
  | "operationsStartDate";

/** Every detected regime is kept; ORBIT never picks one for the user (§8.5). */
export type ExtractedFiscalRegime = {
  code: string;
  label: string | null;
  startDate: string | null;
  endDate: string | null;
  status: ExtractedFiscalFieldStatus;
  /** true only when the code was found in the verified official catalog. */
  catalogVerified: boolean;
};

/** Current confirmed value vs value detected in the new document (§8.6, §10.7). */
export type FiscalFieldComparison = {
  field: FiscalExtractionFieldKey | "fiscalRegime";
  current: string | null;
  detected: string | null;
  changed: boolean;
};

/** POST /api/fiscal-extractions { consentId } (planned) → 201; GET /api/fiscal-extractions/[id]. */
export type CreateFiscalExtractionRequest = { consentId: string };

export type FiscalExtractionResult = {
  id: string;
  documentId: string;
  consentId: string;
  purpose: FiscalConsentPurpose;
  clientId: string | null;
  /** UNREADABLE never blocks manual capture (§8.8). */
  status: "PROCESSED" | "PARTIAL" | "UNREADABLE";
  parserVersion: string;
  fields: Record<FiscalExtractionFieldKey, ExtractedFiscalField>;
  regimes: ExtractedFiscalRegime[];
  /** Empty when there is no previously confirmed data. */
  comparison: FiscalFieldComparison[];
  /** User-facing message, e.g. when not every field could be identified. */
  message: string | null;
  createdAt: string;
};

/**
 * Merged into the existing request bodies of POST /api/fiscal-profile and
 * POST/PATCH /api/clients (planned). `confirmed: true` already exists for the
 * fiscal profile; it becomes mandatory for clients only when extractionId is sent.
 * The confirmed values are always the visible values after user corrections.
 */
export type FiscalConfirmation = {
  confirmed: true;
  extractionId?: string;
};

// ---------------------------------------------------------------------------
// CSD metadata (§12-13). Planned routes (Bloque 4, OWNER/ADMIN only):
//   GET  /api/csd → CsdSummary
//   POST /api/csd multipart with the .cer file, the .key file and the key password
//        → 200 CsdSummary, or { error, code: CsdErrorCode } on failure.
// The password is used once to open the key and is never persisted or returned.
// The private key, its password and any decrypted material never reach the browser.

export type CsdStatus =
  | "NOT_CONFIGURED"
  /** Transitional while a request validates; the backend persists only final states. */
  | "VALIDATING"
  | "VALID"
  | "INVALID"
  | "EXPIRED";

/** Safe metadata only (§13.3). Only VALID can enable a stamping attempt. */
export type CsdSummary = {
  status: CsdStatus;
  certificateNumber: string | null;
  rfc: string | null;
  validFrom: string | null;
  validTo: string | null;
  updatedAt: string | null;
  verification: {
    keyMatchesCertificate: boolean;
    rfcMatchesIssuer: boolean;
    withinValidity: boolean;
    /**
     * false when ORBIT could not demonstrate locally, with officially documented
     * properties, that the certificate is a CSD; final validation is by the PAC/SAT (D17).
     */
    csdTypeVerifiedLocally: boolean;
  } | null;
};

export type CsdErrorCode =
  | "CSD_CERTIFICATE_INVALID"
  | "CSD_KEY_INVALID"
  | "CSD_PASSWORD_INVALID"
  | "CSD_KEY_MISMATCH"
  | "CSD_EXPIRED"
  | "CSD_NOT_YET_VALID"
  | "CSD_RFC_MISMATCH"
  | "CSD_ISSUER_PROFILE_REQUIRED"
  | "CSD_FILE_TOO_LARGE"
  | "CSD_UNSUPPORTED";
