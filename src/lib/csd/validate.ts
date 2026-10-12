import type { X509Certificate } from "node:crypto";
import type { PacEnvironment } from "@/types/stamping";
import {
  assertCertificateNumber,
  assertCertificateRfc,
  assertWithinValidity,
  parseCertificate,
  type CertificateInfo,
} from "./certificate";
import { csdCustodyTerms } from "./custody-terms";
import { CsdError } from "./errors";
import {
  assertKeyMatchesCertificate,
  normalizedPkcs8,
  openEncryptedKey,
  readEncryptedKey,
} from "./private-key";
import { isIssuedByTestAuthority } from "./test-authorities";

// Fase 5C.3 §M: steps 3–13 (first half) as pure functions over in-memory buffers. Step 1
// (role, recent sign-in, provider) and step 2 (Fiscal Profile) run in the service before
// this. The first failure stops the flow; nothing is persisted here.

export const maxCsdFileBytes = 16 * 1024;
export const maxCsdPasswordLength = 256;

export type CsdFile = { name: string; bytes: Buffer };
export type CsdUpload = {
  certificate: CsdFile | null;
  privateKey: CsdFile | null;
  password: string | null;
  custodyTermsVersion: string | null;
  accepted: boolean;
};

export type ValidatedCsd = {
  certificate: CertificateInfo & { certificateNumber: string; rfc: string };
  /** Normalized, unencrypted PKCS#8 DER. The caller must overwrite it with zeros. */
  pkcs8: Buffer;
};

const hasExtension = (name: string, extension: string) =>
  name.toLowerCase().endsWith(extension);

export function validateCsdUpload(
  upload: CsdUpload,
  options: {
    profileRfc: string;
    environment: PacEnvironment;
    authorities: readonly X509Certificate[];
    now: Date;
  },
): ValidatedCsd {
  const { certificate, privateKey, password } = upload;
  // 3. Files, password and custody terms.
  if (
    !certificate?.bytes.length ||
    !privateKey?.bytes.length ||
    typeof password !== "string" ||
    !password.length
  )
    throw new CsdError("CSD_FILES_REQUIRED", 3);
  if (Array.from(password).length > maxCsdPasswordLength)
    throw new CsdError("CSD_PASSWORD_INVALID", 3);
  if (
    !upload.accepted ||
    upload.custodyTermsVersion !== csdCustodyTerms.version
  )
    throw new CsdError("CSD_CUSTODY_TERMS_REQUIRED", 3);
  // 4. Size and extension; the browser MIME type is not evidence (§S).
  if (
    certificate.bytes.length > maxCsdFileBytes ||
    privateKey.bytes.length > maxCsdFileBytes
  )
    throw new CsdError("CSD_FILE_TOO_LARGE", 4);
  if (!hasExtension(certificate.name, ".cer"))
    throw new CsdError("CSD_CERTIFICATE_INVALID", 4);
  if (!hasExtension(privateKey.name, ".key"))
    throw new CsdError("CSD_KEY_INVALID", 4);
  // 5–8. Certificate.
  const { x509, info } = parseCertificate(certificate.bytes);
  assertWithinValidity(info, options.now);
  const rfc = assertCertificateRfc(info.der, options.profileRfc);
  const certificateNumber = assertCertificateNumber(info);
  // 8b. §M.0: SANDBOX accepts only certificates signed by an allowlisted test CA, and
  // PRODUCTION never accepts them.
  const isTest = isIssuedByTestAuthority(x509, options.authorities);
  if (isTest !== (options.environment === "SANDBOX"))
    throw new CsdError("CSD_ENVIRONMENT_MISMATCH", "8b");
  // 9–12. Private key.
  const structure = readEncryptedKey(privateKey.bytes);
  const key = openEncryptedKey(privateKey.bytes, structure, password);
  assertKeyMatchesCertificate(x509, key);
  // 13 (first half). Normalized in memory; encryption happens in the service.
  return {
    certificate: { ...info, certificateNumber, rfc },
    pkcs8: normalizedPkcs8(key),
  };
}
