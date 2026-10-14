import type {
  PacResultCode,
  PacStampEvidence,
  PacStampOutcome,
} from "../types";

// Fase 5C.8: strict reading of an SW "Timbrado V4" response (docs/tasks/FASE5C8-PAC-SANDBOX.md
// §13). Official envelope: { status: "success" | "error", message, messageDetail, data }.
// v4 success data: uuid, cfdi, cadenaOriginalSAT, noCertificadoSAT, noCertificadoCFDI,
// selloSAT, selloCFDI, fechaTimbrado, qrCode. Documented errors: "301 - …" (structure),
// "CFDI40xxx - …" (SAT validation), "307. El comprobante contiene un timbre previo." (data =
// the earlier stamp), "CFDI3307 - Timbre duplicado. El customId proporcionado está duplicado."
// (data = the earlier TFD/UUID), "AU2001 - El usuario no tiene saldo en timbres." and 401
// token errors.
//
// Nothing here is trusted: every field is type- and size-checked, unknown fields are ignored,
// messageDetail is never read (it can carry amounts or values), and stamp data only becomes
// EVIDENCE for ORBIT to verify against the CFDI it sent. Ambiguity is UNKNOWN, never a failure.

export const swResponseLimits = Object.freeze({
  /** Whole response body. */
  body: 5 * 1024 * 1024,
  /** The stamped CFDI inside it. */
  cfdi: 4 * 1024 * 1024,
  tfd: 16 * 1024,
  field: 4096,
});

export type SwBodyProblem = "TOO_LARGE" | "TRUNCATED";

const fields = [
  "uuid",
  "selloCFDI",
  "selloSAT",
  "noCertificadoSAT",
  "noCertificadoCFDI",
  "fechaTimbrado",
  "cadenaOriginalSAT",
] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A provider code ("CFDI40119", "307", "AU2001") and its catalog text, if it has no values. */
export function swMessageParts(message: unknown): {
  code: string | null;
  text: string | null;
} {
  if (typeof message !== "string" || message.length > 2048)
    return { code: null, text: null };
  const match = /^\s*([A-Z]{0,8}[0-9]{3,6})\s*[-.:]\s*([\s\S]*)$/.exec(message);
  const code = match?.[1] ?? null;
  const rest = (match ? match[2] : message).replace(/\s+/g, " ").trim();
  // Catalog texts carry no digits; anything with digits may hold amounts, RFCs or UUIDs.
  const text =
    rest && rest.length <= 200 && !/[0-9]/.test(rest) && !/[<>]/.test(rest)
      ? rest
      : null;
  return { code, text };
}

/** Stamp data from `data`, bounded; null when it has nothing usable. */
function evidenceOf(data: unknown): PacStampEvidence | null {
  if (!isObject(data)) return null;
  const text = (value: unknown, limit: number) =>
    typeof value === "string" && value.length > 0 && value.length <= limit
      ? value
      : null;
  const cfdi = text(data.cfdi, swResponseLimits.cfdi);
  const tfd = text(data.tfd, swResponseLimits.tfd);
  const parallel: Record<string, string> = {};
  for (const name of fields) {
    const value = text(data[name], swResponseLimits.field);
    if (value !== null) parallel[name] = value;
  }
  if (!cfdi && !tfd && !Object.keys(parallel).length) return null;
  return Object.freeze({
    cfdi: cfdi ? new Uint8Array(Buffer.from(cfdi, "utf8")) : null,
    tfd: tfd ? new Uint8Array(Buffer.from(tfd, "utf8")) : null,
    fields: Object.freeze(parallel),
  });
}

const unknown = (
  code: PacResultCode,
  providerCode: string | null = null,
  evidence: PacStampEvidence | null = null,
): PacStampOutcome => ({ kind: "UNKNOWN", code, providerCode, evidence });
const rejected = (
  code: PacResultCode,
  retryable: boolean,
  providerCode: string | null = null,
  providerMessage: string | null = null,
): PacStampOutcome => ({
  kind: "REJECTED",
  code,
  retryable,
  providerCode,
  providerMessage,
});

/** status "error" (or an explicit 4xx): duplicates carry stamp data, the rest is a refusal. */
function classifyError(
  httpStatus: number,
  json: Record<string, unknown> | null,
): PacStampOutcome {
  const { code, text } = swMessageParts(json?.message);
  const evidence = evidenceOf(json?.data);
  if (code === "307")
    return evidence?.cfdi
      ? {
          kind: "EVIDENCE",
          code: "PAC_PREVIOUSLY_STAMPED",
          providerCode: code,
          evidence,
        }
      : unknown("PAC_PREVIOUSLY_STAMPED", code, evidence);
  if (code === "CFDI3307")
    return evidence?.cfdi
      ? {
          kind: "EVIDENCE",
          code: "PAC_DUPLICATE_CUSTOM_ID",
          providerCode: code,
          evidence,
        }
      : unknown("PAC_DUPLICATE_CUSTOM_ID", code, evidence);
  if (code === "AU2001") return rejected("PAC_NO_BALANCE", true, code, text);
  if (httpStatus === 401 || httpStatus === 403)
    return rejected("PAC_AUTH_FAILED", true, code, text);
  if (httpStatus === 429) return rejected("PAC_RATE_LIMITED", true, code, text);
  if (httpStatus >= 500) return unknown("PAC_SERVER_ERROR", code);
  if (httpStatus === 200 || (httpStatus >= 400 && httpStatus < 500)) {
    if (code && (/^CFDI40[0-9]{3}$/.test(code) || /^3[0-9]{2}$/.test(code)))
      return rejected("PAC_CFDI_REJECTED", false, code, text);
    // An explicit error without stamp data. On 200 that contradicts the documented contract.
    return httpStatus === 200
      ? unknown("PAC_RESPONSE_INVALID", code)
      : rejected("PAC_REQUEST_REJECTED", false, code, text);
  }
  return unknown("PAC_RESPONSE_INVALID", code);
}

/**
 * The outcome of one HTTP exchange with SW: status, Content-Type and the body read under the
 * size limit (`problem` when it was cut or exceeded). Pure: no I/O, no secrets involved.
 */
export function classifySwResponse(response: {
  status: number;
  contentType: string | null;
  body: Uint8Array | null;
  problem: SwBodyProblem | null;
}): PacStampOutcome {
  const { status } = response;
  if (status >= 300 && status < 400) return unknown("PAC_REDIRECT");
  const explicitRefusal = status >= 400 && status < 500;
  let json: Record<string, unknown> | null = null;
  if (
    !response.problem &&
    response.body &&
    /^application\/json\b/i.test(response.contentType?.trim() ?? "")
  ) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        response.body,
      );
      const parsed: unknown = JSON.parse(text);
      json = isObject(parsed) ? parsed : null;
    } catch {
      json = null;
    }
  }
  if (response.problem && !explicitRefusal)
    return unknown(
      response.problem === "TOO_LARGE"
        ? "PAC_RESPONSE_TOO_LARGE"
        : "PAC_CONNECTION_LOST",
    );
  if (status >= 500)
    return unknown("PAC_SERVER_ERROR", swMessageParts(json?.message).code);
  if (explicitRefusal) return classifyError(status, json);
  if (status !== 200 || !json) return unknown("PAC_RESPONSE_INVALID");
  if (json.status === "error") return classifyError(status, json);
  if (json.status !== "success") return unknown("PAC_RESPONSE_INVALID");
  const evidence = evidenceOf(json.data);
  // v4 success must carry the complete stamped CFDI: without it there is nothing to verify,
  // yet the PAC may have stamped.
  if (!evidence?.cfdi) return unknown("PAC_RESPONSE_INVALID", null, evidence);
  return {
    kind: "EVIDENCE",
    code: "PAC_STAMPED",
    providerCode: null,
    evidence,
  };
}
