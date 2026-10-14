import "server-only";
import { randomBytes } from "node:crypto";
import { pacSubmission } from "@/lib/cfdi40/schema";
import {
  customIdPattern,
  type PacProvider,
  type PacStampOutcome,
  type PacStampRequest,
} from "../types";
import { swHostAllowed, swStampPath, type SwPacConfiguration } from "./config";
import {
  classifySwResponse,
  swResponseLimits,
  type SwBodyProblem,
} from "./response";

// Fase 5C.8: the real SW sapien sandbox adapter (docs/tasks/FASE5C8-PAC-SANDBOX.md §11-12).
// One POST of the EXACT bytes of an XsdValidatedCfdi40 to the allowlisted origin, with an
// explicit timeout, no redirects, a bounded response read and strict classification. The
// token is used only to build the Authorization header: it never reaches an outcome, an error,
// a log or the database. A retry inside one stamp() happens only when the connection was never
// established (nothing reached SW), with the same bytes and CustomID; after that, any doubt is
// UNKNOWN and reconciliation decides (FASE5C §20.5).

export const swAdapterId = "sw-stamp-v4-customid@1";
/** Above this the request is refused before sending (ORBIT CFDIs are a few KB). */
export const swMaxRequestBytes = 1024 * 1024;

type Transport = (url: string, init: RequestInit) => Promise<Response>;
export type SwAdapterOptions = {
  /** Test seam; production uses the global fetch (undici, normal TLS validation). */
  transport?: Transport;
  /** Whole exchange, headers and body (default 30 s). */
  timeoutMs?: number;
  /** Retries when the connection could not be established (default 2). */
  connectRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

// Errors raised before any byte of the request could reach the server.
const notConnected = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
function errorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function multipart(xml: Uint8Array) {
  let boundary = "";
  do boundary = "orbit-" + randomBytes(16).toString("hex");
  while (Buffer.from(xml).includes(boundary));
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="xml"; filename="cfdi.xml"\r\n' +
        "Content-Type: text/xml\r\n\r\n",
      "utf8",
    ),
    Buffer.from(xml),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function readBounded(
  response: Response,
): Promise<{ body: Uint8Array | null; problem: SwBodyProblem | null }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > swResponseLimits.body) {
    await response.body?.cancel().catch(() => undefined);
    return { body: null, problem: "TOO_LARGE" };
  }
  if (!response.body) return { body: new Uint8Array(0), problem: null };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > swResponseLimits.body) {
        await reader.cancel().catch(() => undefined);
        return { body: null, problem: "TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { body: null, problem: "TRUNCATED" };
  }
  return { body: new Uint8Array(Buffer.concat(chunks)), problem: null };
}

/**
 * The SW sandbox PacProvider for an available configuration. Throws for anything but an
 * available SANDBOX configuration: PRODUCTION cannot be built in this phase.
 */
export function createSwPacAdapter(
  configuration: SwPacConfiguration,
  options: SwAdapterOptions = {},
): PacProvider {
  if (!configuration.available || configuration.environment !== "SANDBOX")
    throw new Error("PAC_SANDBOX_UNAVAILABLE");
  const url = new URL(swStampPath, configuration.origin);
  if (!swHostAllowed(url, configuration.environment))
    throw new Error("PAC_HOST_NOT_ALLOWED");
  const endpoint = url.href;
  const authorization = `Bearer ${configuration.token}`;
  const transport: Transport =
    options.transport ?? ((target, init) => fetch(target, init));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const connectRetries = options.connectRetries ?? 2;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function exchange(
    xml: Uint8Array,
    customId: string,
  ): Promise<PacStampOutcome | "NOT_CONNECTED"> {
    const { body, contentType } = multipart(xml);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await transport(endpoint, {
          method: "POST",
          headers: {
            Authorization: authorization,
            customid: customId,
            "Content-Type": contentType,
            Accept: "application/json",
          },
          body: new Uint8Array(body),
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted)
          return {
            kind: "UNKNOWN",
            code: "PAC_TIMEOUT",
            providerCode: null,
            evidence: null,
          };
        const code = errorCode(error);
        return code && notConnected.has(code)
          ? "NOT_CONNECTED"
          : {
              kind: "UNKNOWN",
              code: "PAC_CONNECTION_LOST",
              providerCode: null,
              evidence: null,
            };
      }
      // A redirect is never followed (and a Location header never read).
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        return classifySwResponse({
          status: response.status,
          contentType: null,
          body: null,
          problem: null,
        });
      }
      const { body: payload, problem } = await readBounded(response);
      if (controller.signal.aborted)
        return {
          kind: "UNKNOWN",
          code: "PAC_TIMEOUT",
          providerCode: null,
          evidence: null,
        };
      return classifySwResponse({
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: payload,
        problem,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    id: "SW_SAPIEN" as const,
    environment: configuration.environment,
    adapter: swAdapterId,
    async stamp(request: PacStampRequest): Promise<PacStampOutcome> {
      // Only a registered, unchanged XsdValidatedCfdi40 may leave ORBIT.
      const { cfdi } = pacSubmission(request.submission?.cfdi);
      if (!customIdPattern.test(request.customId))
        throw new Error("PAC_CUSTOM_ID_INVALID");
      if (cfdi.bytes.byteLength > swMaxRequestBytes)
        return {
          kind: "REJECTED",
          code: "PAC_REQUEST_TOO_LARGE",
          retryable: false,
          providerCode: null,
          providerMessage: null,
        };
      const bytes = new Uint8Array(cfdi.bytes);
      for (let attempt = 0; ; attempt++) {
        const outcome = await exchange(bytes, request.customId);
        if (outcome !== "NOT_CONNECTED") return outcome;
        if (attempt >= connectRetries)
          return {
            kind: "REJECTED",
            code: "PAC_NOT_SUBMITTED",
            retryable: true,
            providerCode: null,
            providerMessage: null,
          };
        // Nothing reached SW: the same bytes and CustomID may be sent again.
        await sleep(250 * 4 ** attempt);
      }
    },
  });
}
