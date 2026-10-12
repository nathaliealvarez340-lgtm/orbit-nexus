import {
  createPrivateKey,
  randomBytes,
  sign,
  verify,
  type KeyObject,
  type X509Certificate,
} from "node:crypto";
import { encryptedPrivateKeyInfo, type EncryptedKeyStructure } from "./der";
import { looksLikePem } from "./certificate";
import { CsdError } from "./errors";

// Fase 5C.3 §M steps 9–13 for the private key (.key). The password opens the key once, in
// memory, and is never retried with variants, compared, stored or included in an error.
//
// Memory limits (Node/JS, A.3): the password arrives as a JS string from the multipart
// parser; strings are immutable and cannot be wiped, so it lives until garbage collection.
// Only the Buffer copy handed to OpenSSL is overwritten. The decrypted key is an OpenSSL
// KeyObject that cannot be zeroed from JS either; it is never cached and goes out of scope
// with the request. The PKCS#8 export (a Buffer) is overwritten by the caller after
// encryption. These are best-effort measures, not guarantees.

const pbes2 = "1.2.840.113549.1.5.13";
const pbkdf2 = "1.2.840.113549.1.5.12";
// §M.11 — UNVERIFIED against official SAT test keys: PBES2/PBKDF2 with ciphers that the
// default OpenSSL 3 provider of Node supports without the legacy provider.
const supportedCiphers = new Set([
  "1.2.840.113549.3.7", // des-ede3-cbc
  "2.16.840.1.101.3.4.1.2", // aes-128-cbc
  "2.16.840.1.101.3.4.1.22", // aes-192-cbc
  "2.16.840.1.101.3.4.1.42", // aes-256-cbc
]);

/** Step 9: PKCS#8 EncryptedPrivateKeyInfo, DER, well formed. */
export function readEncryptedKey(bytes: Buffer): EncryptedKeyStructure {
  if (looksLikePem(bytes)) throw new CsdError("CSD_KEY_INVALID", 9);
  try {
    return encryptedPrivateKeyInfo(bytes);
  } catch {
    throw new CsdError("CSD_KEY_INVALID", 9);
  }
}

export const isSupportedKeyEncryption = (structure: EncryptedKeyStructure) =>
  structure.scheme === pbes2 &&
  structure.kdf === pbkdf2 &&
  !!structure.cipher &&
  supportedCiphers.has(structure.cipher);

/**
 * Steps 10–11. Once step 9 proved the outer structure, a failure while decrypting can only
 * come from the password (or a corrupted body, which is equivalent for the user, §W):
 * OpenSSL reports "bad decrypt" and, for about 1 in 256 wrong passwords whose padding
 * happens to be valid, an ASN.1 error on the decrypted bytes. Both are
 * CSD_PASSWORD_INVALID. An unsupported algorithm is CSD_UNSUPPORTED; anything else is
 * CSD_KEY_INVALID. OpenSSL text is never surfaced.
 */
export function openEncryptedKey(
  bytes: Buffer,
  structure: EncryptedKeyStructure,
  password: string,
): KeyObject {
  if (!isSupportedKeyEncryption(structure))
    throw new CsdError("CSD_UNSUPPORTED", 11);
  const passphrase = Buffer.from(password, "utf8");
  let key: KeyObject;
  try {
    key = createPrivateKey({
      key: bytes,
      format: "der",
      type: "pkcs8",
      passphrase,
    });
  } catch (error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code === "ERR_OSSL_BAD_DECRYPT" || code.startsWith("ERR_OSSL_ASN1_"))
      throw new CsdError("CSD_PASSWORD_INVALID", 10);
    if (code.includes("UNSUPPORTED")) throw new CsdError("CSD_UNSUPPORTED", 11);
    throw new CsdError("CSD_KEY_INVALID", 10);
  } finally {
    passphrase.fill(0);
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "rsa")
    throw new CsdError("CSD_UNSUPPORTED", 11);
  return key;
}

/**
 * Step 12: the key belongs to the certificate: OpenSSL's pair check AND an RSA-SHA256
 * signature of a random challenge verified with the certificate's public key.
 */
export function assertKeyMatchesCertificate(
  certificate: X509Certificate,
  key: KeyObject,
) {
  let matches = false;
  try {
    matches = certificate.checkPrivateKey(key);
    if (matches) {
      const challenge = randomBytes(32);
      matches = verify(
        "sha256",
        challenge,
        certificate.publicKey,
        sign("sha256", challenge, key),
      );
    }
  } catch {
    matches = false;
  }
  if (!matches) throw new CsdError("CSD_KEY_MISMATCH", 12);
}

/** Step 13 (first half): unencrypted PKCS#8 DER, in memory only. The caller zeroes it. */
export function normalizedPkcs8(key: KeyObject) {
  try {
    return key.export({ type: "pkcs8", format: "der" });
  } catch {
    throw new CsdError("CSD_ENCRYPTION_FAILED", 13);
  }
}
