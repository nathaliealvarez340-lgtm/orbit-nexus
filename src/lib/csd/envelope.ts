import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { PacEnvironment } from "@/types/stamping";
import { decipherAll } from "./decipher";
import {
  KeyProviderError,
  type CsdKeyProvider,
  type KeyRef,
} from "./key-provider";

// Fase 5C.3 §H/§I: envelope encryption of the normalized PKCS#8 private key.
// AES-256-GCM with a random 32-byte DEK per CSD and a random 12-byte IV; the DEK is wrapped
// by the KeyProvider. Both layers bind an AAD so a ciphertext copied to another row,
// Organization, certificate or environment fails its tag.

export const envelopeVersion = 1;
export const aadVersion = 1;
export const envelopeAlgorithm = "AES-256-GCM";

export type EnvelopeContext = {
  organizationId: string;
  csdCertificateId: string;
  certificateSha256: string;
  environment: PacEnvironment;
};

/** Columns of CsdPrivateKey. Never returned, logged or audited. */
export type SealedPrivateKey = {
  envelopeVersion: number;
  algorithm: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  wrappedDek: Uint8Array;
  kekProvider: string;
  kekId: string;
  kekVersion: number;
  aadVersion: number;
};

/** The envelope cannot be opened: missing key/version or failed integrity. */
export class EnvelopeError extends Error {
  constructor(public reason: "KEY_UNAVAILABLE" | "INTEGRITY") {
    super(reason);
    this.name = "EnvelopeError";
  }
}

// Canonical UTF-8 strings with a fixed order; no JSON. Values are server-generated ids,
// a hex fingerprint and an enum, none of which can contain "|".
function field(value: string) {
  if (!value || /[|=\s]/.test(value)) throw new EnvelopeError("INTEGRITY");
  return value;
}
export const dataAad = (context: EnvelopeContext) =>
  Buffer.from(
    `orbit:csd-private-key:v1|org=${field(context.organizationId)}|csd=${field(context.csdCertificateId)}|cert=${field(context.certificateSha256)}|env=${field(context.environment)}`,
    "utf8",
  );
export const wrapAad = (context: EnvelopeContext, ref: KeyRef) =>
  Buffer.from(
    `orbit:csd-dek:v1|org=${field(context.organizationId)}|csd=${field(context.csdCertificateId)}|kek=${field(ref.keyId)}:${ref.keyVersion}`,
    "utf8",
  );

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();
const refOf = (sealed: SealedPrivateKey): KeyRef => ({
  provider: sealed.kekProvider,
  keyId: sealed.kekId,
  keyVersion: sealed.kekVersion,
});

/**
 * Decrypts the PKCS#8 DER in memory. The caller must overwrite the returned buffer with
 * zeros as soon as it is no longer needed. Never tries another version or provider.
 */
export async function openPrivateKey(
  provider: CsdKeyProvider,
  context: EnvelopeContext,
  sealed: SealedPrivateKey,
): Promise<Buffer> {
  if (
    sealed.envelopeVersion !== envelopeVersion ||
    sealed.aadVersion !== aadVersion ||
    sealed.algorithm !== envelopeAlgorithm ||
    sealed.iv.length !== 12 ||
    sealed.authTag.length !== 16 ||
    !sealed.ciphertext.length
  )
    throw new EnvelopeError("INTEGRITY");
  const ref = refOf(sealed);
  if (ref.provider !== provider.provider || !provider.canUnwrap(ref))
    throw new EnvelopeError("KEY_UNAVAILABLE");
  let dek: Buffer | null = null;
  try {
    try {
      dek = await provider.unwrapDataKey(
        ref,
        Buffer.from(sealed.wrappedDek),
        wrapAad(context, ref),
      );
    } catch (error) {
      if (error instanceof KeyProviderError)
        throw new EnvelopeError(error.reason);
      throw new EnvelopeError("KEY_UNAVAILABLE");
    }
    if (dek.length !== 32) throw new EnvelopeError("INTEGRITY");
    const decipher = createDecipheriv("aes-256-gcm", dek, sealed.iv);
    decipher.setAAD(dataAad(context));
    decipher.setAuthTag(sealed.authTag);
    try {
      return decipherAll(decipher, sealed.ciphertext);
    } catch {
      throw new EnvelopeError("INTEGRITY");
    }
  } finally {
    dek?.fill(0);
  }
}

/**
 * §H: encrypts the PKCS#8 DER and verifies the round trip (SHA-256 of the recovered key
 * equals the original) before anything is persisted. Throws EnvelopeError
 * ("KEY_UNAVAILABLE") when the provider is unavailable and Error otherwise; the caller maps
 * both to stable codes. The DEK and the recovered copy are overwritten (best effort).
 */
export async function sealPrivateKey(
  provider: CsdKeyProvider,
  context: EnvelopeContext,
  pkcs8: Buffer,
): Promise<SealedPrivateKey> {
  const state = provider.availability();
  if (!state.available) throw new EnvelopeError("KEY_UNAVAILABLE");
  const dek = randomBytes(32);
  let recovered: Buffer | null = null;
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    cipher.setAAD(dataAad(context));
    const ciphertext = Buffer.concat([cipher.update(pkcs8), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const { ref, wrapped } = await provider.wrapDataKey(
      dek,
      wrapAad(context, state.current),
    );
    // The wrap AAD names the key version, so it must be the one the provider used.
    if (
      ref.provider !== state.current.provider ||
      ref.keyId !== state.current.keyId ||
      ref.keyVersion !== state.current.keyVersion
    )
      throw new Error("CSD_KEK_CHANGED");
    const sealed: SealedPrivateKey = {
      envelopeVersion,
      algorithm: envelopeAlgorithm,
      ciphertext,
      iv,
      authTag,
      wrappedDek: wrapped,
      kekProvider: ref.provider,
      kekId: ref.keyId,
      kekVersion: ref.keyVersion,
      aadVersion,
    };
    recovered = await openPrivateKey(provider, context, sealed);
    if (!timingSafeEqual(sha256(recovered), sha256(pkcs8)))
      throw new Error("CSD_ROUND_TRIP_FAILED");
    return sealed;
  } finally {
    dek.fill(0);
    recovered?.fill(0);
  }
}

/**
 * §J: re-wraps the DEK with the provider's current KEK version. The key ciphertext, IV and
 * tag do not change and the user's password is not needed. Pure: the caller persists the
 * result (with rewrappedAt) inside its own transaction.
 */
export async function rewrapPrivateKey(
  provider: CsdKeyProvider,
  context: EnvelopeContext,
  sealed: SealedPrivateKey,
): Promise<SealedPrivateKey> {
  const state = provider.availability();
  if (!state.available) throw new EnvelopeError("KEY_UNAVAILABLE");
  const ref = refOf(sealed);
  if (ref.provider !== provider.provider || !provider.canUnwrap(ref))
    throw new EnvelopeError("KEY_UNAVAILABLE");
  let dek: Buffer | null = null;
  let recovered: Buffer | null = null;
  try {
    try {
      dek = await provider.unwrapDataKey(
        ref,
        Buffer.from(sealed.wrappedDek),
        wrapAad(context, ref),
      );
    } catch (error) {
      throw new EnvelopeError(
        error instanceof KeyProviderError ? error.reason : "KEY_UNAVAILABLE",
      );
    }
    const { ref: next, wrapped } = await provider.wrapDataKey(
      dek,
      wrapAad(context, state.current),
    );
    if (next.keyVersion !== state.current.keyVersion)
      throw new Error("CSD_KEK_CHANGED");
    const rewrapped: SealedPrivateKey = {
      ...sealed,
      wrappedDek: wrapped,
      kekProvider: next.provider,
      kekId: next.keyId,
      kekVersion: next.keyVersion,
    };
    // The re-wrapped envelope must still open before it replaces the old one.
    recovered = await openPrivateKey(provider, context, rewrapped);
    return rewrapped;
  } finally {
    dek?.fill(0);
    recovered?.fill(0);
  }
}
