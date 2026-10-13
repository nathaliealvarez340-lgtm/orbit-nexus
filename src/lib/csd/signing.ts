import {
  constants,
  createPrivateKey,
  sign,
  verify,
  type KeyObject,
  type X509Certificate,
} from "node:crypto";
import {
  EnvelopeError,
  openPrivateKey,
  type EnvelopeContext,
  type SealedPrivateKey,
} from "./envelope";
import type { CsdKeyProvider } from "./key-provider";

// Fase 5C.6: the CFDI seal (FASE5C §16.2, FASE5C3 §AA.6–§AA.8, Anexo 20): RSA signature with
// SHA-256 over the UTF-8 bytes of the cadena original, padding PKCS#1 v1.5
// (RSASSA-PKCS1-v1_5, RFC 8017 §8.2), Base64 in the XML. Only node:crypto (OpenSSL); no
// cryptography of our own. The padding is always passed explicitly, so neither a library
// default nor an "rsa-pss" key can turn the seal into RSA-PSS.
//
// Memory (honest limits): the decrypted PKCS#8 exists in a Buffer only until OpenSSL has
// parsed it, and is then overwritten with zeros; the DEK is overwritten by openPrivateKey.
// The KeyObject holds an OpenSSL copy of the key that JavaScript cannot wipe: it never
// leaves signWithCustodiedKey, is never cached, and is released when garbage collected.
// Strings, V8 copies and OpenSSL internals are outside our control; zeroing is best effort.

export const cfdiSealAlgorithm = Object.freeze({
  name: "RSA-SHA256 PKCS#1 v1.5",
  hash: "sha256",
  padding: constants.RSA_PKCS1_PADDING,
});

export type CsdSigningFailure =
  | "KEY_UNAVAILABLE"
  | "INTEGRITY"
  | "MISMATCH"
  | "SIGN_FAILED"
  | "VERIFY_FAILED";

/** A seal could not be produced; carries a reason only, never key material or OpenSSL text. */
export class CsdSigningError extends Error {
  constructor(public readonly reason: CsdSigningFailure) {
    super(reason);
    this.name = "CsdSigningError";
  }
}

const isRsa = (key: KeyObject) => key.asymmetricKeyType === "rsa";

/** RSA signature of `message`: SHA-256, PKCS#1 v1.5. Deterministic for the same key. */
export function signCfdiSeal(key: KeyObject, message: Uint8Array): Buffer {
  if (key.type !== "private" || !isRsa(key))
    throw new CsdSigningError("MISMATCH");
  try {
    return sign(cfdiSealAlgorithm.hash, message, {
      key,
      padding: cfdiSealAlgorithm.padding,
    });
  } catch {
    throw new CsdSigningError("SIGN_FAILED");
  }
}

/**
 * True only if `signature` is an RSA-SHA256 PKCS#1 v1.5 signature of `message` by the
 * public key, with exactly the modulus length. Never throws.
 */
export function verifyCfdiSeal(
  publicKey: KeyObject,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  const bits = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
  if (publicKey.type !== "public" || !isRsa(publicKey) || !bits) return false;
  if (signature.length !== Math.ceil(bits / 8)) return false;
  try {
    return verify(
      cfdiSealAlgorithm.hash,
      message,
      { key: publicKey, padding: cfdiSealAlgorithm.padding },
      signature,
    );
  } catch {
    return false;
  }
}

/** Decrypts the envelope and parses the key; the PKCS#8 Buffer is zeroed before returning. */
async function loadPrivateKey(
  open: typeof openPrivateKey,
  provider: CsdKeyProvider,
  context: EnvelopeContext,
  sealed: SealedPrivateKey,
): Promise<KeyObject> {
  let pkcs8: Buffer | null = null;
  try {
    try {
      pkcs8 = await open(provider, context, sealed);
    } catch (error) {
      throw new CsdSigningError(
        error instanceof EnvelopeError ? error.reason : "KEY_UNAVAILABLE",
      );
    }
    try {
      return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    } catch {
      throw new CsdSigningError("INTEGRITY");
    }
  } finally {
    pkcs8?.fill(0);
  }
}

/**
 * CsdVault.sign (FASE5C3 §AA.8): opens the custodied key through its KeyProvider, checks it
 * belongs to `certificate`, signs `message` and verifies the signature with the
 * certificate's public key before returning it. The key never leaves this function. Every
 * call opens the envelope again: there is no cache of decrypted keys. `open` exists so tests
 * can observe that the decrypted PKCS#8 is overwritten; production uses the default.
 */
export async function signWithCustodiedKey(
  provider: CsdKeyProvider,
  context: EnvelopeContext,
  sealed: SealedPrivateKey,
  certificate: X509Certificate,
  message: Uint8Array,
  open: typeof openPrivateKey = openPrivateKey,
): Promise<Buffer> {
  const key = await loadPrivateKey(open, provider, context, sealed);
  let matches = false;
  try {
    matches = isRsa(key) && certificate.checkPrivateKey(key);
  } catch {
    matches = false;
  }
  if (!matches) throw new CsdSigningError("MISMATCH");
  const signature = signCfdiSeal(key, message);
  if (!verifyCfdiSeal(certificate.publicKey, message, signature))
    throw new CsdSigningError("VERIFY_FAILED");
  return signature;
}
