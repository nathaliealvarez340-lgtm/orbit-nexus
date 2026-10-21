import { X509Certificate, createHash } from "node:crypto";

// Fase 5C.3 §M.0: a CSD is a TEST certificate only when its issuer signature verifies
// against an allowlisted official test certificate authority (SAT, or the one the PAC
// names for its sandbox). Name matching alone is never enough.
//
// Every entry of the official allowlist was added with explicit authorization (§AB.7) and
// carries its SHA-256, source URL and retrieval date, like the SAT resources (§AA.1). Its
// DER is pinned (testAuthorities re-hashes it and checks subject and serial), and a
// certificate counts as TEST only if this CA issued it AND its signature verifies with this
// CA's key: another CA with the same subject is rejected. Only CAs are listed, never a CSD.
// If the list is emptied or any entry is invalid, no CSD can be taken into custody outside
// automated tests (fail closed).
export type OfficialTestAuthority = {
  name: string;
  /** Base64 DER of the CA certificate. */
  certificateDer: string;
  sha256: string;
  /** Subject DN exactly as node:crypto prints it (X509Certificate.subject). */
  subject: string;
  /** Upper-case hex, as X509Certificate.serialNumber. */
  serialNumberHex: string;
  sourceUrl: string;
  /** Path of the certificate inside the archive at sourceUrl, if it came in one. */
  sourcePath?: string;
  sourceArchiveSha256?: string;
  retrievedAt: string;
};

export const officialTestAuthorities: readonly OfficialTestAuthority[] = [
  {
    // SAT test CA "AC UAT" (valid 2022-03-04 → 2030-03-04, RSA 4096, basicConstraints
    // critical CA:TRUE pathlen:0). It issues the SAT test CSD of the 2023-05-18 batch, such
    // as KIJ0906199R1 used by the SW sandbox. It is signed by the SAT test root "Agencia
    // Certficadora Raiz Beta ANG" from the same archive, which is not listed: only the
    // direct issuer is. The 2018 "AC UAT" in that archive has an almost identical subject
    // and a different key; it is not listed and does not verify the 2023 CSD.
    // omawww.sat.gob.mx does not answer on port 443, so the archive was fetched over HTTP
    // (no redirects) from the SAT page "Certificados de Sello Digital"; the SHA-256 pin and
    // the signature check over the independently obtained CSD bound that risk.
    name: "SAT AC UAT 2022 (pruebas)",
    certificateDer:
      "MIIHrDCCBZSgAwIBAgIUMDAwMDAwMDAwMDAwOTAwMDEwNjEwDQYJKoZIhvcNAQELBQAwgbIx" +
      "CzAJBgNVBAYTAk1YMQ0wCwYDVQQIDARDRE1YMRkwFwYDVQQHDBBDaXVkYWQgZGUgTWV4aWNv" +
      "MRgwFgYDVQQKDA9CYW5jbyBkZSBNZXhpY28xDzANBgNVBAsMBkRHU1BJTTErMCkGA1UEAwwi" +
      "QWdlbmNpYSBDZXJ0ZmljYWRvcmEgUmFpeiBCZXRhIEFORzEhMB8GCSqGSIb3DQEJARYSaWVz" +
      "QGJhbnhpY28ub3JnLm14MB4XDTIyMDMwNDE4NDgxMloXDTMwMDMwNDE4NDgxMlowggErMQ8w" +
      "DQYDVQQDDAZBQyBVQVQxLjAsBgNVBAoMJVNFUlZJQ0lPIERFIEFETUlOSVNUUkFDSU9OIFRS" +
      "SUJVVEFSSUExGjAYBgNVBAsMEVNBVC1JRVMgQXV0aG9yaXR5MSgwJgYJKoZIhvcNAQkBFhlv" +
      "c2Nhci5tYXJ0aW5lekBzYXQuZ29iLm14MR0wGwYDVQQJDBQzcmEgY2VycmFkYSBkZSBjYWxp" +
      "ejEOMAwGA1UEEQwFMDYzNzAxCzAJBgNVBAYTAk1YMRkwFwYDVQQIDBBDSVVEQUQgREUgTUVY" +
      "SUNPMREwDwYDVQQHDAhDT1lPQUNBTjERMA8GA1UELRMIMi41LjQuNDUxJTAjBgkqhkiG9w0B" +
      "CQITFnJlc3BvbnNhYmxlOiBBQ0RNQS1TQVQwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIK" +
      "AoICAQC5Ty/8WKoXseeo2InfeAV9IpjKYn8uTqdkocG8aFOjROVVXt6CpHFGqqocfCxBM/jH" +
      "0vSUjTQfK190dIeWzsVaHs+42LwlbeAPHMZBuxPdpSAUvAR2PCo3v6aBzNxz6MUUeZCYzGWg" +
      "5W5rqsgWN1UlZsQVKABp02DUXl2QD64UlEoHpg6G/41P1nckuqJsGqCCx0TEAK5S1ZiHE39t" +
      "DdcEciHZiQh3GqF6ZjTueDe70Q74nAbjuLbDPH2WCh6CcY+bQOdqLA8CR1wI/1A1kVutYAUx" +
      "upZHte0V3PbbE4aJK3yeuwdk0TaFliDZO8bYsYr9IS1l4a4wg4hUyVG5A4+SBBRhwFGABXmI" +
      "4+PWADyoFkcCoARmcG6nu1fw/1jPa5sWSri50PBtCuDL7yRpUXF/hpMDAYYvh8XRFlFPicq2" +
      "YCo3mwuFoVyYx377WcLJqCau8GAOiY1vEKIPIpeWhWptpWWpIQTaovgjYN2xKI5OuINMd57C" +
      "kPMyPwj5xgED7UI8vhjyx2fEsLSwDKUVX10n1pcON70gbWKG29VCiS9+J1KxtfJ0gWTfQLxz" +
      "VbckscDDHdLbx9Mq5qVGzR8Yn2Td3sYnwVtNV1QjJLoJi7Syahbk8f3GOFnAfm3vmRCKbElL" +
      "oxOqHqze3kTalbWOsITP3wpvwl51sWtCQ3P5wK2M/wIDAQABo4IBPDCCATgwgfIGA1UdIwSB" +
      "6jCB54AU2HUDcYsF8kh1jiDFGbVrdcK49u+hgbikgbUwgbIxCzAJBgNVBAYTAk1YMQ0wCwYD" +
      "VQQIDARDRE1YMRkwFwYDVQQHDBBDaXVkYWQgZGUgTWV4aWNvMRgwFgYDVQQKDA9CYW5jbyBk" +
      "ZSBNZXhpY28xDzANBgNVBAsMBkRHU1BJTTErMCkGA1UEAwwiQWdlbmNpYSBDZXJ0ZmljYWRv" +
      "cmEgUmFpeiBCZXRhIEFORzEhMB8GCSqGSIb3DQEJARYSaWVzQGJhbnhpY28ub3JnLm14ghQw" +
      "MDAwMDAwMDAwMDA5OTAwMDAwMDAdBgNVHQ4EFgQUgtoL2RWLq/rzNo9EAZvwC9VLYcowEgYD" +
      "VR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAfYwDQYJKoZIhvcNAQELBQADggIBAIkv" +
      "+pxJyZ8i2FhijBDPzpEmu1PpIe2kO+VOPsy8x/Qplii/J0BVov9EQjpR+aqV0SoxSCm/Ig/X" +
      "CXZNF2cvbLcB3HKSlRAY/AFUyCiZyNOEc4NIdA1ARTOTbup30teSVPNZYz1/0O3lFZL76etW" +
      "/0yPfzWa0yWfOPMSTTRZrmY0NNvcae4mCe/auTrEAvMA/dcgSBqZ1CzOluNNFdgTNCcI3l2u" +
      "V+Pg6Xbm+61diZXLhgyzfw7iAbIcdd6WT8gXjHGIV0YrixneGk/cqhpY4+LR5/GOn3nNn5SZ" +
      "X8A3LWxKxyGwOV3vHONRUfrs8HxYhKM/YUsUJRls2QSScnMKcYwRONqg0IorrCfzZgiE2CnS" +
      "ZCCE9RGCn3bi6vHIaZiQxkFYePQ/L6EGzFkqDNn+8chhlm+nFUu8BdWVwIbGePuryizfOkAD" +
      "D+RFeLEQc7yeHQ24//lXXhMBUvTgVqdGLx7zCKGyR856IJWWMSacyBeZ3PIyUJI6JPd4086O" +
      "3nfEcaa+UErMvD/8Iz59A2fBr4C1nhRbbsuphKJymeutQcUK8k4I0XC4vaC531WRwTB2TiHM" +
      "4NP8myPCYDSSwCp5WZnQMA8it5FQvuCo4OhmOnwxeyMlkzRIhSJ3ZG5xLtADe4axg3o1FYLi" +
      "p8qfUvTdcJzjjNHZkejRgGsU3PXRm6jJ",
    sha256: "ff9c220344614c06fa483b846d7959f9ba0806dfa85610f4ace3b2df8aefacf9",
    subject: [
      "CN=AC UAT",
      "O=SERVICIO DE ADMINISTRACION TRIBUTARIA",
      "OU=SAT-IES Authority",
      "emailAddress=oscar.martinez@sat.gob.mx",
      "street=3ra cerrada de caliz",
      "postalCode=06370",
      "C=MX",
      "ST=CIUDAD DE MEXICO",
      "L=COYOACAN",
      "x500UniqueIdentifier=2.5.4.45",
      "unstructuredName=responsable: ACDMA-SAT",
    ].join("\n"),
    serialNumberHex: "3030303030303030303030303930303031303631",
    sourceUrl:
      "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Certificados_P.zip",
    sourcePath: "Certificados_P/Certificados_UAT_2022/AC_UAT_2022.crt",
    sourceArchiveSha256:
      "3883297015baea0fd5c5143d4d5ea4c37333ce6235ef71a1351688a25149203a",
    retrievedAt: "2026-10-21",
  },
];

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
      const certificate = new X509Certificate(der);
      if (
        certificate.subject !== authority.subject ||
        certificate.serialNumber.toUpperCase() !== authority.serialNumberHex
      )
        throw new Error("METADATA_MISMATCH");
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
