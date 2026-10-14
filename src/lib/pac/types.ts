import type { Cfdi40PacSubmission } from "@/lib/cfdi40/schema";
import type { PacEnvironment } from "@/types/stamping";

// Fase 5C.8: provider-neutral PAC port (FASE5C §17). The fiscal domain never sees provider
// URLs, headers, credentials or error formats: an adapter turns one stamping request into a
// PacStampOutcome with ORBIT codes, and the domain verifies any evidence itself
// (src/lib/cfdi40/stamped.ts). An outcome never carries a token, a raw response or the XML
// sent; `evidence` holds only what the PAC returned for ORBIT to verify.

export type PacProviderId = "SW_SAPIEN";

/** ORBIT result codes of a stamping request (stable; shown to support, never raw text). */
export type PacResultCode =
  /** Configuration: no sandbox credential; nothing was sent. */
  | "PAC_SANDBOX_UNAVAILABLE"
  /** Fiscal PRODUCTION requested: blocked in this phase; nothing was sent. */
  | "PAC_PRODUCTION_BLOCKED"
  /** The XML exceeds the request limit; nothing was sent. */
  | "PAC_REQUEST_TOO_LARGE"
  /** The connection was never established (DNS, refused, TLS): nothing reached the PAC. */
  | "PAC_NOT_SUBMITTED"
  /** The PAC rejected the credential (expired, revoked or malformed token). */
  | "PAC_AUTH_FAILED"
  /** The account has no stamps left (SW AU2001). */
  | "PAC_NO_BALANCE"
  /** The PAC refused to process the request now (rate limit). */
  | "PAC_RATE_LIMITED"
  /** Deterministic fiscal/structure rejection (SAT validation or PAC 30x rules). */
  | "PAC_CFDI_REJECTED"
  /** Any other explicit 4xx rejection. */
  | "PAC_REQUEST_REJECTED"
  /** Stamped now. */
  | "PAC_STAMPED"
  /** The same CFDI (same Sello) was stamped before; the PAC returned that stamp. */
  | "PAC_PREVIOUSLY_STAMPED"
  /** The same CustomID was used before; the PAC returned the earlier result (maybe partial). */
  | "PAC_DUPLICATE_CUSTOM_ID"
  /** Ambiguous: the request may have reached the PAC. */
  | "PAC_TIMEOUT"
  | "PAC_CONNECTION_LOST"
  | "PAC_SERVER_ERROR"
  | "PAC_REDIRECT"
  | "PAC_RESPONSE_INVALID"
  | "PAC_RESPONSE_TOO_LARGE"
  /** The PAC answered with a stamp that ORBIT could not verify against what it sent. */
  | "PAC_RESPONSE_INCONSISTENT";

/** What a PAC returned about a stamp, for ORBIT to verify; never trusted on its own. */
export type PacStampEvidence = {
  /** The complete stamped CFDI exactly as returned, when the PAC returned it. */
  readonly cfdi: Uint8Array | null;
  /** A standalone TimbreFiscalDigital as returned, when the PAC returned only that. */
  readonly tfd: Uint8Array | null;
  /** Parallel fields reported by the PAC; each must match the TFD before anything is kept. */
  readonly fields: Readonly<{
    uuid?: string;
    selloCFDI?: string;
    selloSAT?: string;
    noCertificadoSAT?: string;
    noCertificadoCFDI?: string;
    fechaTimbrado?: string;
    cadenaOriginalSAT?: string;
  }>;
};

export type PacStampOutcome =
  /** The PAC returned stamp data (new stamp or a duplicate): ORBIT must verify it. */
  | {
      readonly kind: "EVIDENCE";
      readonly code:
        "PAC_STAMPED" | "PAC_PREVIOUSLY_STAMPED" | "PAC_DUPLICATE_CUSTOM_ID";
      readonly providerCode: string | null;
      readonly evidence: PacStampEvidence;
    }
  /** The PAC confirmed it did NOT stamp this request. */
  | {
      readonly kind: "REJECTED";
      readonly code: PacResultCode;
      /** True when the same CFDI may succeed later without changes (auth, balance, …). */
      readonly retryable: boolean;
      readonly providerCode: string | null;
      /** Provider catalog text without values (no digits), or null. */
      readonly providerMessage: string | null;
    }
  /** ORBIT cannot prove whether the PAC stamped: reconcile, never retry blindly. */
  | {
      readonly kind: "UNKNOWN";
      readonly code: PacResultCode;
      readonly providerCode: string | null;
      /** Partial evidence (e.g. a duplicate CustomID answered with only a TFD), if any. */
      readonly evidence: PacStampEvidence | null;
    };

export type PacStampRequest = {
  /** The only thing a PAC may receive: a sealed CFDI validated against the official XSD. */
  readonly submission: Cfdi40PacSubmission;
  /** Stable for the logical attempt, derived from the StampAttempt id, never fiscal data. */
  readonly customId: string;
};

export interface PacProvider {
  readonly id: PacProviderId;
  readonly environment: PacEnvironment;
  /** Adapter identifier recorded with each attempt (e.g. "sw-stamp-v4/customid@1"). */
  readonly adapter: string;
  stamp(request: PacStampRequest): Promise<PacStampOutcome>;
}

/** CustomID rules shared by ORBIT and SW: at most 100 characters, no whitespace. */
export const customIdPattern =
  /^orbit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const customIdFor = (attemptId: string) => "orbit-" + attemptId;
