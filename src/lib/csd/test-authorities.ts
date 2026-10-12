import { X509Certificate, createHash } from "node:crypto";

// Fase 5C.3 §M.0: a CSD is a TEST certificate only when its issuer signature verifies
// against an allowlisted official test certificate authority (SAT, or the one the PAC
// names for its sandbox). Name matching alone is never enough.
//
// The official allowlist is EMPTY: the official test CA certificates have not been
// obtained and approved yet (§AB.7). While it is empty no CSD can be taken into custody
// outside automated tests (fail closed). Adding an entry requires explicit authorization
// and its SHA-256, source URL and retrieval date, versioned like the SAT resources (§AA.1).
export type OfficialTestAuthority = {
  name: string;
  /** Base64 DER of the CA certificate. */
  certificateDer: string;
  sha256: string;
  sourceUrl: string;
  retrievedAt: string;
};

export const officialTestAuthorities: readonly OfficialTestAuthority[] = [];

type Env = Record<string, string | undefined>;

/** Exact value required in CSD_E2E_HARNESS; anything else ("1", "true", …) is off. */
export const e2eHarnessFlag = "local-ephemeral-only";

function isLoopbackDatabase(value: string | undefined) {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    return false;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:")
    return false;
  // Literal loopback IPs only: a name such as "localhost" can be remapped.
  if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") return false;
  // The pg/libpq connection string accepts host overrides in its parameters.
  for (const key of url.searchParams.keys())
    if (/^(host|hostaddr|service|servicefile)$/i.test(key)) return false;
  return true;
}

/**
 * Whether the local E2E harness (scripts/csd-e2e.mjs, under `next dev`) may add the
 * synthetic CA in CSD_E2E_TEST_AUTHORITIES to the test allowlist. ALL must hold:
 * 1. not a production build or runtime: `process.env.NODE_ENV` is written literally so
 *    `next build` inlines "production" and this returns false before reading anything
 *    else; the given environment must also say NODE_ENV=development or test;
 * 2. no Vercel variable with a value (VERCEL, VERCEL_ENV, VERCEL_URL, …);
 * 3. fiscal SANDBOX: PAC_ENVIRONMENT empty or SANDBOX;
 * 4. DATABASE_URL is PostgreSQL on a literal loopback IP with no host override (the
 *    ephemeral PGlite of the harness);
 * 5. CSD_E2E_HARNESS is exactly `e2eHarnessFlag`.
 * It reads process environment variables only: no request, header, cookie or body
 * reaches it. Why this is not a production bypass: a real deployment fails 1 (production
 * build) and, on Vercel, 2; a synthetic CA can only make a certificate count as a TEST
 * certificate, which step 8b accepts only in SANDBOX and which is stored with
 * environment SANDBOX forever (a SANDBOX CSD never serves PRODUCTION). Unit and
 * integration tests pass their synthetic CA as an argument and never use this path.
 */
export function e2eHarnessEnabled(env: Env = process.env) {
  if (process.env.NODE_ENV === "production") return false;
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") return false;
  if (env.CSD_E2E_HARNESS !== e2eHarnessFlag) return false;
  if (
    Object.entries(env).some(
      ([key, value]) => /^VERCEL/i.test(key) && !!value?.trim(),
    )
  )
    return false;
  const fiscal = env.PAC_ENVIRONMENT?.trim().toUpperCase() ?? "";
  if (fiscal && fiscal !== "SANDBOX") return false;
  return isLoopbackDatabase(env.DATABASE_URL);
}

/** Parsed allowlist for this process; invalid entries make the whole list unusable. */
export function testAuthorities(env: Env = process.env): X509Certificate[] {
  try {
    const official = officialTestAuthorities.map((authority) => {
      const der = Buffer.from(authority.certificateDer, "base64");
      if (createHash("sha256").update(der).digest("hex") !== authority.sha256)
        throw new Error("HASH_MISMATCH");
      return der;
    });
    const injected = e2eHarnessEnabled(env)
      ? (env.CSD_E2E_TEST_AUTHORITIES ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => Buffer.from(item, "base64"))
      : [];
    return [...official, ...injected].map((der) => {
      const certificate = new X509Certificate(der);
      if (!certificate.ca) throw new Error("NOT_A_CA");
      return certificate;
    });
  } catch {
    return [];
  }
}

/** True only if an allowlisted test CA issued and signed this certificate. */
export function isIssuedByTestAuthority(
  certificate: X509Certificate,
  authorities: readonly X509Certificate[],
) {
  return authorities.some((authority) => {
    try {
      return (
        certificate.checkIssued(authority) &&
        certificate.verify(authority.publicKey)
      );
    } catch {
      return false;
    }
  });
}
