// Fase 5C.2 §7: central redaction for anything that leaves the request boundary as a log
// line, audit metadata or diagnostic. Values are dropped or masked, never echoed.

// Key names whose values are never kept, whatever their content.
const secretKey =
  /pass(word)?|secret|token|authorization|cookie|session|api[-_]?key|private[-_]?key|credential|signature|otp|verification|reset|\bcode$|cer(tificate)?$|\bkey$|csd|e\.?firma|(^|[-_])fiel($|[-_])/i;
// Key names that carry fiscal documents or payloads.
const payloadKey =
  /xml|content|bytes|raw|ocr|payload|snapshot|document|csf|constancia|pdf|image|body|fields|regimes/i;
// Personal or fiscal identifiers kept only as masked values.
const identifierKey =
  /rfc|curp|email|phone|tel[eé]fono|address|domicilio|name$|nombre|legal/i;

const patterns: [RegExp, string][] = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[private-key]",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/gi, "[credentials]@"],
  [/<\?xml[\s\S]*|<cfdi:Comprobante[\s\S]*/gi, "[xml]"],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  // CURP before RFC: a CURP starts with a valid RFC prefix.
  [/\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi, "[curp]"],
  [/(?<![A-ZÑ&0-9])[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}(?![A-Z0-9])/gi, "[rfc]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[token]"],
];

export const isSecretKey = (key: string) => secretKey.test(key);
export const isPayloadKey = (key: string) => payloadKey.test(key);

/** Masks secrets, identifiers and document fragments inside free text. */
export function redactText(value: string, maxLength = 200) {
  let text = value;
  for (const [pattern, replacement] of patterns)
    text = text.replace(pattern, replacement);
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

/**
 * Deep copy safe for logs: secret and payload keys are removed, identifier keys are
 * masked, strings are redacted and structures are bounded.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array || value instanceof ArrayBuffer)
    return "[binary]";
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (value instanceof Headers) return redactHeaders(value);
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (secretKey.test(key)) output[key] = "[redacted]";
      else if (payloadKey.test(key)) output[key] = "[omitted]";
      else if (identifierKey.test(key))
        output[key] = item == null ? item : "[masked]";
      else output[key] = redact(item, depth + 1);
    }
    return output;
  }
  return "[unsupported]";
}

const forbiddenHeaders = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
]);
export function redactHeaders(headers: Headers | Record<string, string>) {
  const entries =
    headers instanceof Headers
      ? [...headers.entries()]
      : Object.entries(headers);
  return Object.fromEntries(
    entries.map(([key, value]) => [
      key.toLowerCase(),
      forbiddenHeaders.has(key.toLowerCase()) || secretKey.test(key)
        ? "[redacted]"
        : redactText(value, 120),
    ]),
  );
}

/**
 * What may be logged about an unexpected error: its class and a stable code (Prisma,
 * driver or Postgres SQLSTATE). Never the message, stack, SQL, parameters or meta.
 */
export function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: typeof error };
  const candidate = error as Error & {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
  };
  const codes = [
    candidate.code,
    candidate.meta?.driverAdapterError?.cause?.originalCode,
  ].filter(
    (code): code is string =>
      typeof code === "string" && /^[A-Z0-9_]{2,40}$/i.test(code),
  );
  return {
    name: /^[A-Za-z][A-Za-z0-9]{0,60}$/.test(error.name) ? error.name : "Error",
    ...(codes.length ? { code: codes.join("/") } : {}),
  };
}

/** One structured line per unexpected server error; safe for production logs. */
export function logSafeError(scope: string, error: unknown) {
  console.error(
    JSON.stringify({
      level: "error",
      scope: scope.replace(/[^a-z0-9:/_-]/gi, "").slice(0, 60),
      ...describeError(error),
    }),
  );
}
