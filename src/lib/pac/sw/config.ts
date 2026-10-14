import { fiscalEnvironment } from "@/lib/csd/custody";
import type { PacEnvironment } from "@/types/stamping";

// Fase 5C.8: SW sapien / SmarterWEB configuration (docs/tasks/FASE5C8-PAC-SANDBOX.md §2-3).
// Sources (official, audited 2026-10-14): developers.sw.com.mx "Timbrado V4 – CustomID"
// (updated 2026-02-16) and "Stamp" (updated 2026-10-12), and SW's own Node SDK
// (lunasoft/sw-sdk-nodejs RequestHelper._buildPath): POST {origin}/v4/cfdi33/stamp/{version}
// with the sealed XML as the multipart field "xml" (plain XML; "/b64" would mean Base64), the
// headers "Authorization: Bearer <token>" and "customid", response version v4. "/cfdi33" is
// kept by SW for compatibility and accepts CFDI 4.0.
//
// The origins are constants: no request, database row or user value chooses the host, and
// SANDBOX and PRODUCTION never share an origin or a credential. In this phase only SANDBOX
// can be configured; PRODUCTION is blocked whatever the environment says.

export const swOrigins = Object.freeze({
  SANDBOX: "https://services.test.sw.com.mx",
  PRODUCTION: "https://services.sw.com.mx",
} satisfies Record<PacEnvironment, string>);
/** Timbrado V4 with CustomID, response version v4 ("todos los datos del timbrado"). */
export const swStampPath = "/v4/cfdi33/stamp/v4";
/** The only variable read for the credential (an SW sandbox Bearer token). */
export const swSandboxTokenVariable = "SW_SANDBOX_TOKEN";

export type SwPacConfiguration =
  | {
      readonly available: true;
      readonly environment: "SANDBOX";
      readonly origin: string;
      /** Secret: never logged, stored, audited, returned or put in an error. */
      readonly token: string;
    }
  | {
      readonly available: false;
      readonly environment: PacEnvironment | null;
      readonly code: "PAC_SANDBOX_UNAVAILABLE" | "PAC_PRODUCTION_BLOCKED";
    };

type Env = Record<string, string | undefined>;

// SW tokens are JWTs ("El token debe contener 3 partes"): three Base64url parts, no spaces,
// CR, LF or other characters that could alter the request headers.
const tokenShape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/**
 * The PAC configuration of this process. SANDBOX needs SW_SANDBOX_TOKEN with a token shape;
 * otherwise PAC_SANDBOX_UNAVAILABLE (nothing is sent, nothing falls back to PRODUCTION and no
 * credential is invented). PRODUCTION, or an invalid PAC_ENVIRONMENT, is never available.
 */
export function resolveSwPacConfiguration(
  env: Env = process.env,
): SwPacConfiguration {
  const environment = fiscalEnvironment(env);
  if (environment === "PRODUCTION")
    return { available: false, environment, code: "PAC_PRODUCTION_BLOCKED" };
  if (environment !== "SANDBOX")
    return { available: false, environment, code: "PAC_SANDBOX_UNAVAILABLE" };
  const token = env[swSandboxTokenVariable]?.trim() ?? "";
  if (!token || token.length > 4096 || !tokenShape.test(token))
    return { available: false, environment, code: "PAC_SANDBOX_UNAVAILABLE" };
  return {
    available: true,
    environment,
    origin: swOrigins.SANDBOX,
    token,
  };
}

/** Exact host allowlist per environment; anything else is refused before a request. */
export function swHostAllowed(url: URL, environment: PacEnvironment) {
  const origin = new URL(swOrigins[environment]);
  return (
    url.protocol === "https:" &&
    url.hostname === origin.hostname &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    environment === "SANDBOX"
  );
}
