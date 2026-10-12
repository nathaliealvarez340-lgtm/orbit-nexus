import type { X509Certificate } from "node:crypto";
import type { PacEnvironment } from "@/types/stamping";
import { keyProviderFor, type CsdKeyProvider } from "./key-provider";
import { testAuthorities } from "./test-authorities";

// Fase 5C.3 §G.1/§Z: custody is decided by the FISCAL environment, never by the hosting
// environment (VERCEL_ENV). A Vercel production deployment may run fiscal SANDBOX with
// demonstrated test CSD only. `fiscalProductionRequested()` (privacy-notice.ts) mixes both
// axes for another gate and is deliberately not reused.

type Env = Record<string, string | undefined>;

/**
 * PAC_ENVIRONMENT: SANDBOX by default, PRODUCTION only when explicit. Any other value is
 * a configuration error: null, and custody stays unavailable (fail closed).
 * Fiscal PRODUCTION may also come from an Organization entitlement or a PRODUCTION CSD;
 * entitlements belong to the stamping block and do not exist yet.
 */
export function fiscalEnvironment(
  env: Env = process.env,
): PacEnvironment | null {
  const value = env.PAC_ENVIRONMENT?.trim().toUpperCase() ?? "";
  if (!value || value === "SANDBOX") return "SANDBOX";
  if (value === "PRODUCTION") return "PRODUCTION";
  return null;
}

/** §D.1: CSD_REAUTH_WINDOW_SECONDS, 900 by default; outside 60–3600 the default applies. */
export function reauthWindowSeconds(env: Env = process.env) {
  const raw = env.CSD_REAUTH_WINDOW_SECONDS?.trim() ?? "";
  if (!/^\d{1,5}$/.test(raw)) return 900;
  const value = Number(raw);
  return value >= 60 && value <= 3600 ? value : 900;
}

/** §D.1: a session is recent while its sign-in (Session.createdAt) is inside the window. */
export function isRecentSignIn(
  sessionCreatedAt: Date,
  now = new Date(),
  env: Env = process.env,
) {
  const age = now.getTime() - sessionCreatedAt.getTime();
  return (
    Number.isFinite(age) &&
    age >= -60_000 &&
    age < reauthWindowSeconds(env) * 1000
  );
}

/**
 * §AB: the Legal Production Gate (published privacy notice covering custody, custody
 * terms reviewed by counsel, KMS/HSM chosen and listed as subprocessor, …) is pending.
 * Until it is completed and this is changed with authorization, fiscal PRODUCTION custody
 * is unavailable.
 * Also pending before PRODUCTION: §M.0 only proves TEST certificates; "not issued by a
 * test CA" does not prove a SAT production certificate. Enabling PRODUCTION must first
 * require the chain to the official SAT production CAs (contract decision).
 */
export const productionLegalGateSatisfied = false;

export type Custody = {
  environment: PacEnvironment | null;
  provider: CsdKeyProvider | null;
  authorities: readonly X509Certificate[];
  available: boolean;
};

/**
 * Whether this server can take a CSD into custody now:
 * - SANDBOX: configured provider available and a non-empty test CA allowlist (§M.0),
 *   since SANDBOX only accepts demonstrated test CSD;
 * - PRODUCTION: external KMS/HSM provider and the Legal gate; neither exists in this
 *   phase, so it is always unavailable. Never falls back to "env".
 */
export function resolveCustody(
  env: Env = process.env,
  authorities: readonly X509Certificate[] = testAuthorities(env),
): Custody {
  const environment = fiscalEnvironment(env);
  if (!environment)
    return { environment, provider: null, authorities, available: false };
  const provider = keyProviderFor(environment, env);
  const providerReady = provider.availability().available;
  // SANDBOX only ever holds demonstrated test CSD, whatever the provider (§Z.6).
  const available =
    environment === "SANDBOX"
      ? providerReady && authorities.length > 0
      : providerReady &&
        provider.provider !== "env" &&
        productionLegalGateSatisfied;
  return { environment, provider, authorities, available };
}
