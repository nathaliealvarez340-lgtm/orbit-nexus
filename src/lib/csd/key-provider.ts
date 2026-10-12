import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { PacEnvironment } from "@/types/stamping";

// Fase 5C.3 §G: the KEK (master key) wraps one random data key (DEK) per CSD and never
// lives in the database. Providers are chosen explicitly per FISCAL environment (not per
// hosting environment): there is no default key and no fallback between providers.

export type KeyRef = { provider: string; keyId: string; keyVersion: number };
export type ProviderUnavailableReason =
  "NOT_CONFIGURED" | "INVALID_CONFIGURATION";
export type ProviderAvailability =
  | { available: true; current: KeyRef }
  | { available: false; reason: ProviderUnavailableReason };

export interface CsdKeyProvider {
  /** "env" today; "kms:<id>" in the future. */
  readonly provider: string;
  /** Available only with a complete and valid configuration; never invents a key. */
  availability(): ProviderAvailability;
  /** Can it unwrap data keys wrapped with that reference? */
  canUnwrap(ref: KeyRef): boolean;
  wrapDataKey(
    dek: Buffer,
    aad: Buffer,
  ): Promise<{ ref: KeyRef; wrapped: Buffer }>;
  unwrapDataKey(ref: KeyRef, wrapped: Buffer, aad: Buffer): Promise<Buffer>;
}

/** Wrapping or unwrapping failed: the key is unavailable or the blob fails its tag. */
export class KeyProviderError extends Error {
  constructor(public reason: "KEY_UNAVAILABLE" | "INTEGRITY") {
    super(reason);
    this.name = "KeyProviderError";
  }
}

type Env = Record<string, string | undefined>;

const keyIdPattern = /^[A-Za-z0-9._:-]{1,100}$/;
const versionPattern = /^[1-9]\d{0,5}$/;
// 32 bytes in canonical base64: 43 characters plus one "=".
const kekPattern = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const wrappedLength = 12 + 32 + 16;

function readKek(env: Env, version: number) {
  const value = env["CSD_KEK_V" + version]?.trim();
  if (!value || !kekPattern.test(value)) return null;
  const key = Buffer.from(value, "base64");
  if (key.length === 32) return key;
  key.fill(0);
  return null;
}

/**
 * §G.2: KEK versions in environment variables. Allowed only for development, tests and
 * fiscal SANDBOX with demonstrated test CSD (§G.1, §M.0); the caller enforces that scope.
 * It never logs or exposes the KEK or a DEK, and reads the variables on every use so a
 * key is not kept in memory longer than one operation.
 */
export function envKeyProvider(env: Env = process.env): CsdKeyProvider {
  const settings = () => {
    const keyId = env.CSD_KEK_ID?.trim() ?? "";
    const version = env.CSD_KEK_CURRENT_VERSION?.trim() ?? "";
    return { keyId, version };
  };
  const availability = (): ProviderAvailability => {
    const { keyId, version } = settings();
    if (
      !keyId &&
      !version &&
      !Object.keys(env).some((k) => /^CSD_KEK_V\d+$/.test(k))
    )
      return { available: false, reason: "NOT_CONFIGURED" };
    if (!keyIdPattern.test(keyId) || !versionPattern.test(version))
      return { available: false, reason: "INVALID_CONFIGURATION" };
    const key = readKek(env, Number(version));
    if (!key) return { available: false, reason: "INVALID_CONFIGURATION" };
    key.fill(0);
    return {
      available: true,
      current: { provider: "env", keyId, keyVersion: Number(version) },
    };
  };
  const keyFor = (ref: KeyRef) => {
    if (ref.provider !== "env" || ref.keyId !== settings().keyId) return null;
    if (!Number.isSafeInteger(ref.keyVersion) || ref.keyVersion < 1)
      return null;
    return readKek(env, ref.keyVersion);
  };
  return {
    provider: "env",
    availability,
    canUnwrap(ref) {
      const key = keyFor(ref);
      key?.fill(0);
      return !!key;
    },
    async wrapDataKey(dek, aad) {
      const state = availability();
      if (!state.available) throw new KeyProviderError("KEY_UNAVAILABLE");
      const key = keyFor(state.current);
      if (!key) throw new KeyProviderError("KEY_UNAVAILABLE");
      try {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(aad);
        const wrapped = Buffer.concat([
          iv,
          cipher.update(dek),
          cipher.final(),
          cipher.getAuthTag(),
        ]);
        return { ref: state.current, wrapped };
      } finally {
        key.fill(0);
      }
    },
    async unwrapDataKey(ref, wrapped, aad) {
      const key = keyFor(ref);
      if (!key) throw new KeyProviderError("KEY_UNAVAILABLE");
      try {
        if (wrapped.length !== wrappedLength)
          throw new KeyProviderError("INTEGRITY");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          wrapped.subarray(0, 12),
        );
        decipher.setAAD(aad);
        decipher.setAuthTag(wrapped.subarray(44));
        try {
          return Buffer.concat([
            decipher.update(wrapped.subarray(12, 44)),
            decipher.final(),
          ]);
        } catch {
          throw new KeyProviderError("INTEGRITY");
        }
      } finally {
        key.fill(0);
      }
    },
  };
}

/** A provider that exists by name but cannot be used (not configured or not implemented). */
export function unavailableKeyProvider(
  provider: string,
  reason: ProviderUnavailableReason,
): CsdKeyProvider {
  return {
    provider,
    availability: () => ({ available: false, reason }),
    canUnwrap: () => false,
    wrapDataKey: async () => {
      throw new KeyProviderError("KEY_UNAVAILABLE");
    },
    unwrapDataKey: async () => {
      throw new KeyProviderError("KEY_UNAVAILABLE");
    },
  };
}

const kmsPattern = /^kms:[a-z0-9][a-z0-9._-]{0,60}$/;

/**
 * §G.1/§G.2: the provider configured for one fiscal environment.
 * - SANDBOX: CSD_KEY_PROVIDER_SANDBOX = "env" | "kms:<id>".
 * - PRODUCTION: CSD_KEY_PROVIDER_PRODUCTION = "kms:<id>"; "env" is an invalid
 *   configuration and leaves PRODUCTION unavailable.
 * No KMS/HSM is implemented in this phase, so "kms:<id>" is recognized but unavailable.
 * Empty means custody for that environment is unavailable. Never falls back to "env".
 */
export function keyProviderFor(
  environment: PacEnvironment,
  env: Env = process.env,
): CsdKeyProvider {
  const variable =
    environment === "PRODUCTION"
      ? "CSD_KEY_PROVIDER_PRODUCTION"
      : "CSD_KEY_PROVIDER_SANDBOX";
  const value = env[variable]?.trim() ?? "";
  if (!value) return unavailableKeyProvider("none", "NOT_CONFIGURED");
  if (value === "env")
    return environment === "SANDBOX"
      ? envKeyProvider(env)
      : unavailableKeyProvider("env", "INVALID_CONFIGURATION");
  if (kmsPattern.test(value))
    return unavailableKeyProvider(value, "NOT_CONFIGURED");
  return unavailableKeyProvider("invalid", "INVALID_CONFIGURATION");
}
