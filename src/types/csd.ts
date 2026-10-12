import type { CsdErrorCode, CsdSummary } from "./fiscal-identity";
import type { PacEnvironment } from "./stamping";

// Fase 5C.3 §P: additions to the published CSD contract. `CsdStatus`, `CsdSummary` and
// `CsdErrorCode` (fiscal-identity.ts) stay unchanged; every response here is a superset.
// Routes (OWNER/ADMIN only; mutations need same origin and a recent sign-in, §D.1):
//   GET  /api/csd                → CsdState
//   GET  /api/csd/custody-terms  → CsdCustodyTerms
//   POST /api/csd                → 200 ConfigureCsdResponse (multipart: certificate, privateKey,
//                                  password, custodyTermsVersion, accepted=true, optional
//                                  replace=true + expectedActiveCsdId)
//   POST /api/csd/disable        → 200 CsdState (JSON DisableCsdRequest)
//   GET  /api/csd/history        → CsdHistoryItem[] (max. 50)
// Errors: { error: <curated Spanish message>, code: CsdApiErrorCode }.
// Never in a DTO: password, key, ciphertext, IV, tag, DEK, KEK, kekId/kekVersion, the
// certificate DER or the email of whoever configured it.

export type CsdInvalidReason =
  | "NOT_YET_VALID"
  /** The Fiscal Profile RFC no longer matches the certificate. */
  | "RFC_CHANGED"
  /** KeyProvider, KEK version or custody for the current fiscal environment unavailable. */
  | "KEY_UNAVAILABLE"
  /** The envelope could not be verified. */
  | "INTEGRITY";

/** GET /api/csd */
export type CsdState = CsdSummary & {
  id: string | null;
  environment: PacEnvironment | null;
  invalidReason: CsdInvalidReason | null;
  /** true when 30 days or less remain until validTo. */
  expiresSoon: boolean;
  /** Actions allowed to the current user (the UI does not decide permissions). */
  canManage: boolean;
  /** false: the server cannot take custody of a CSD (KeyProvider/flag/legal gate). */
  serviceAvailable: boolean;
};

export type CsdCustodyTerms = { version: string; text: string };

/** POST /api/csd → 200. created=false: the same certificate is already active (idempotent). */
export type ConfigureCsdResponse = CsdState & { created: boolean };

export type DisableCsdRequest = { expectedActiveCsdId: string; confirm: true };

export type CsdHistoryItem = {
  id: string;
  status: "ACTIVE" | "REPLACED" | "DISABLED";
  certificateNumber: string;
  rfc: string;
  environment: PacEnvironment;
  validFrom: string;
  validTo: string;
  configuredAt: string;
  /** Visible name, never an email. */
  configuredBy: string | null;
  endedAt: string | null;
};

export type CsdApiErrorCode =
  | CsdErrorCode
  | "CSD_FILES_REQUIRED"
  | "CSD_CUSTODY_TERMS_REQUIRED"
  | "CSD_RFC_UNVERIFIABLE"
  | "CSD_ALREADY_ACTIVE"
  | "CSD_CONFLICT"
  | "CSD_IN_USE"
  | "CSD_FORBIDDEN"
  | "CSD_REAUTH_REQUIRED"
  | "CSD_ENVIRONMENT_MISMATCH"
  | "CSD_RATE_LIMITED"
  | "CSD_SERVICE_UNAVAILABLE"
  | "CSD_ENCRYPTION_FAILED"
  | "CSD_NOT_FOUND";
