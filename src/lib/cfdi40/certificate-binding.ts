import { X509Certificate, createHash } from "node:crypto";
import { certificateNumberFromSerial } from "@/lib/csd/certificate-number";
import { Cfdi40Error, cfdi40Issue } from "./errors";
import type { Cfdi40CertificateBinding } from "./types";

// Fase 5C.5: NoCertificado and Certificado of a CFDI come only from the PUBLIC certificate of
// the active VALID CSD (FASE5C3 §AA.6). Nothing here reads, opens or decrypts a private key;
// the key is needed only to sign, in the next gate.

const base64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type CertificateBindingProblem =
  | "NO_CERTIFICADO_INVALID"
  | "CERTIFICADO_INVALID"
  | "NOT_A_SEAL_CERTIFICATE"
  | "NO_CERTIFICADO_MISMATCH"
  | "OUTSIDE_VALIDITY";

/**
 * Problems of NoCertificado/Certificado as they will be written in the XML: 20 digits,
 * canonical Base64 of an X.509 certificate that is not a CA and has an RSA key, and a
 * NoCertificado derived from its serial number (FASE5C3 §M.8). With `now`, the
 * certificate must also be in force at that instant.
 */
export function certificateBindingProblems(
  binding: Cfdi40CertificateBinding,
  now?: Date,
): CertificateBindingProblem[] {
  const problems: CertificateBindingProblem[] = [];
  if (!/^[0-9]{20}$/.test(binding.noCertificado))
    problems.push("NO_CERTIFICADO_INVALID");
  let certificate: X509Certificate | null = null;
  try {
    certificate =
      binding.certificadoBase64 && base64.test(binding.certificadoBase64)
        ? new X509Certificate(Buffer.from(binding.certificadoBase64, "base64"))
        : null;
  } catch {
    certificate = null;
  }
  if (!certificate) return [...problems, "CERTIFICADO_INVALID"];
  if (certificate.ca || certificate.publicKey.asymmetricKeyType !== "rsa")
    problems.push("NOT_A_SEAL_CERTIFICATE");
  if (
    !problems.includes("NO_CERTIFICADO_INVALID") &&
    certificateNumberFromSerial(certificate.serialNumber) !==
      binding.noCertificado
  )
    problems.push("NO_CERTIFICADO_MISMATCH");
  if (now) {
    const time = now.getTime();
    if (!(
      new Date(certificate.validFrom).getTime() <= time &&
      time < new Date(certificate.validTo).getTime()
    ))
      problems.push("OUTSIDE_VALIDITY");
  }
  return problems;
}

/** Throws CERTIFICATE_BINDING_INVALID unless the binding is usable (at `now`, when given). */
export function assertCertificateBinding(
  binding: Cfdi40CertificateBinding,
  now?: Date,
) {
  if (certificateBindingProblems(binding, now).length)
    throw new Cfdi40Error([
      cfdi40Issue(
        "CERTIFICATE_BINDING_INVALID",
        "Comprobante/@Certificado",
        "ORBIT",
      ),
    ]);
}

/**
 * The binding of a stored CSD certificate (DER), after checking that the bytes are the
 * certificate its record describes: same SHA-256, serial number and NoCertificado.
 */
export function certificateBindingFromDer(
  der: Uint8Array,
  record: {
    certificateSha256: string;
    serialNumberHex: string;
    certificateNumber: string;
  },
  now: Date,
): Cfdi40CertificateBinding {
  const bytes = Buffer.from(der);
  const mismatch = () =>
    new Cfdi40Error([
      cfdi40Issue(
        "CSD_CERTIFICATE_MISMATCH",
        "Comprobante/@Certificado",
        "ORBIT",
      ),
    ]);
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    record.certificateSha256
  )
    throw mismatch();
  let serial: string;
  try {
    serial = new X509Certificate(bytes).serialNumber.toUpperCase();
  } catch {
    throw mismatch();
  }
  if (serial !== record.serialNumberHex.toUpperCase()) throw mismatch();
  const binding = {
    noCertificado: record.certificateNumber,
    certificadoBase64: bytes.toString("base64"),
  };
  if (certificateBindingProblems(binding).includes("NO_CERTIFICADO_MISMATCH"))
    throw mismatch();
  assertCertificateBinding(binding, now);
  return binding;
}
