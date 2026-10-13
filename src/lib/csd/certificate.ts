import { X509Certificate, createHash } from "node:crypto";
import {
  certificateSignatureAlgorithm,
  certificateSubject,
  certificateValidity,
  readDocument,
} from "./der";
import { CsdError } from "./errors";
import { certificateNumberFromSerial } from "./certificate-number";

// Fase 5C.3 §M steps 5–8 for the public certificate (.cer). Only what node:crypto and the
// DER structure can demonstrate is checked. csdTypeVerifiedLocally stays false: no
// officially documented property distinguishing a CSD from an e.firma has been verified.

export type CertificateInfo = {
  der: Buffer;
  sha256: string;
  serialNumberHex: string;
  publicKeyAlgorithm: "RSA";
  publicKeyBits: number;
  signatureAlgorithm: string;
  validFrom: Date;
  validTo: Date;
};

const signatureAlgorithms: Record<string, string> = {
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
};

/** PEM (or any text armor) is rejected in this phase: DER only (§S). */
export function looksLikePem(bytes: Uint8Array) {
  const text = Buffer.from(bytes.subarray(0, 64))
    .toString("latin1")
    .replace(/^\xEF\xBB\xBF/, "")
    .trimStart();
  return text.startsWith("-----BEGIN");
}

/** Step 5: X.509 DER, not a CA, RSA public key of 2048–8192 bits. */
export function parseCertificate(bytes: Buffer) {
  if (looksLikePem(bytes)) throw new CsdError("CSD_CERTIFICATE_INVALID", 5);
  let x509: X509Certificate;
  let validity: { validFrom: Date; validTo: Date };
  let signatureOid: string;
  try {
    readDocument(bytes);
    x509 = new X509Certificate(bytes);
    validity = certificateValidity(bytes);
    signatureOid = certificateSignatureAlgorithm(bytes);
  } catch {
    throw new CsdError("CSD_CERTIFICATE_INVALID", 5);
  }
  if (x509.ca) throw new CsdError("CSD_CERTIFICATE_INVALID", 5);
  const publicKey = x509.publicKey;
  const bits = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
  if (publicKey.asymmetricKeyType !== "rsa" || bits < 2048 || bits > 8192)
    throw new CsdError("CSD_UNSUPPORTED", 5);
  const info: CertificateInfo = {
    der: Buffer.from(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    serialNumberHex: x509.serialNumber.toUpperCase(),
    publicKeyAlgorithm: "RSA",
    publicKeyBits: bits,
    signatureAlgorithm: signatureAlgorithms[signatureOid] ?? signatureOid,
    ...validity,
  };
  return { x509, info };
}

/** Step 6: validFrom ≤ now < validTo. */
export function assertWithinValidity(info: CertificateInfo, now: Date) {
  if (now.getTime() < info.validFrom.getTime())
    throw new CsdError("CSD_NOT_YET_VALID", 6);
  if (now.getTime() >= info.validTo.getTime())
    throw new CsdError("CSD_EXPIRED", 6);
}

/**
 * §M.7 — UNVERIFIED HYPOTHESIS pending official SAT sources and official test CSD: the
 * taxpayer RFC is the first "/"-separated token of the single subject attribute
 * x500UniqueIdentifier (OID 2.5.4.45), encoded as a string (persona moral:
 * "<RFC moral> / <RFC representante>"). Anything else is unverifiable: never guessed.
 */
export const rfcAttributeOid = "2.5.4.45";
const rfcPattern = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
export function certificateRfc(der: Uint8Array): string | null {
  let attributes: ReturnType<typeof certificateSubject>;
  try {
    attributes = certificateSubject(der);
  } catch {
    return null;
  }
  const matches = attributes.filter((a) => a.oid === rfcAttributeOid);
  if (matches.length !== 1 || !matches[0].value) return null;
  const rfc = matches[0].value.split("/")[0].trim();
  return rfcPattern.test(rfc) ? rfc : null;
}

/** Step 7: the certificate RFC equals the confirmed Fiscal Profile RFC. */
export function assertCertificateRfc(der: Uint8Array, profileRfc: string) {
  const rfc = certificateRfc(der);
  if (!rfc) throw new CsdError("CSD_RFC_UNVERIFIABLE", 7);
  if (rfc !== profileRfc.trim().toUpperCase())
    throw new CsdError("CSD_RFC_MISMATCH", 7);
  return rfc;
}

// §M.8 (unverified hypothesis): NoCertificado from the serial number; see certificate-number.ts.
export { certificateNumberFromSerial };

export function assertCertificateNumber(info: CertificateInfo) {
  const number = certificateNumberFromSerial(info.serialNumberHex);
  if (!number) throw new CsdError("CSD_UNSUPPORTED", 8);
  return number;
}
