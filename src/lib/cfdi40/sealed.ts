import { X509Certificate, createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { certificateNumberFromSerial } from "@/lib/csd/certificate-number";
import { Cfdi40Error, cfdi40Issue } from "./errors";
import type { Cfdi40CertificateBinding, SealedCfdi40Xml } from "./types";

// Fase 5C.4: the only door from "CFDI" to "XSD validation" or "PAC". Two independent locks:
// 1. Compile time: SealedCfdi40Xml carries a type-only brand that no value can have, so an
//    UnsignedCfdi40Xml or an object literal is not assignable to it without a cast.
// 2. Runtime: a value counts as sealed only if the sealing service registered it in this
//    module (WeakSet, not exported) AND its Sello, Certificado and NoCertificado are
//    structurally real. The sealing service does not exist in this phase, so nothing is
//    registered and every value is rejected, including well-formed forgeries.
// Verifying the Sello cryptographically needs the cadena original (official XSLT) and
// belongs to the sealing gate (FASE5C §16.4); it is not claimed here.

const registry = new WeakSet<object>();

export type SealAttributeProblem =
  | "SELLO_MISSING"
  | "SELLO_INVALID"
  | "SELLO_LENGTH_MISMATCH"
  | "CERTIFICADO_MISSING"
  | "CERTIFICADO_INVALID"
  | "NO_CERTIFICADO_INVALID"
  | "NO_CERTIFICADO_MISMATCH"
  | "BINDING_MISMATCH";

// Canonical Base64 only: no whitespace, line breaks or URL alphabet.
const base64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  htmlEntities: false,
});

const decode = (value: string) =>
  value && base64.test(value) ? Buffer.from(value, "base64") : null;

/**
 * Structural checks of the seal attributes of a Comprobante: present, canonical Base64,
 * a real non-CA X.509 certificate, NoCertificado derived from its serial number (§M.8),
 * a Sello as long as the certificate's RSA modulus and not a constant placeholder, and,
 * when given, equal to the certificate binding of the active CSD.
 */
export function sealAttributeProblems(
  xml: string,
  binding?: Cfdi40CertificateBinding,
): SealAttributeProblem[] {
  const problems: SealAttributeProblem[] = [];
  let attrs: Record<string, unknown> = {};
  try {
    const root = (parser.parse(xml) as Record<string, unknown>)[
      "cfdi:Comprobante"
    ];
    if (root && typeof root === "object")
      attrs = root as Record<string, unknown>;
  } catch {
    // Unparseable XML has no seal attributes.
  }
  const text = (name: string) =>
    typeof attrs[name] === "string" ? (attrs[name] as string) : "";
  const sello = text("Sello"),
    certificado = text("Certificado"),
    noCertificado = text("NoCertificado");

  const seal = decode(sello);
  if (!sello) problems.push("SELLO_MISSING");
  else if (
    !seal ||
    seal.length < 128 ||
    seal.length > 1024 ||
    seal.every((byte) => byte === seal[0])
  )
    problems.push("SELLO_INVALID");

  let certificate: X509Certificate | null = null;
  const der = decode(certificado);
  if (!certificado) problems.push("CERTIFICADO_MISSING");
  else {
    try {
      certificate = der ? new X509Certificate(der) : null;
    } catch {
      certificate = null;
    }
    if (!certificate || certificate.ca) problems.push("CERTIFICADO_INVALID");
  }

  if (!/^[0-9]{20}$/.test(noCertificado))
    problems.push("NO_CERTIFICADO_INVALID");
  else if (
    certificate &&
    !certificate.ca &&
    certificateNumberFromSerial(certificate.serialNumber) !== noCertificado
  )
    problems.push("NO_CERTIFICADO_MISMATCH");

  const modulus = certificate?.publicKey.asymmetricKeyDetails?.modulusLength;
  if (
    seal &&
    modulus &&
    seal.length !== modulus / 8 &&
    !problems.includes("SELLO_INVALID")
  )
    problems.push("SELLO_LENGTH_MISMATCH");

  if (
    binding &&
    (binding.noCertificado !== noCertificado ||
      binding.certificadoBase64 !== certificado)
  )
    problems.push("BINDING_MISMATCH");
  return problems;
}

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** True only for a CFDI registered by ORBIT's sealing service and still consistent. */
export function isSealedCfdi40(value: unknown): value is SealedCfdi40Xml {
  if (!value || typeof value !== "object" || !registry.has(value)) return false;
  const candidate = value as Partial<{
    stage: unknown;
    xml: unknown;
    bytes: unknown;
    sha256: unknown;
    certificate: Cfdi40CertificateBinding;
  }>;
  return (
    candidate.stage === "SEALED" &&
    typeof candidate.xml === "string" &&
    candidate.bytes instanceof Uint8Array &&
    Buffer.from(candidate.bytes).toString("utf8") === candidate.xml &&
    sha256(candidate.bytes) === candidate.sha256 &&
    sealAttributeProblems(candidate.xml, candidate.certificate).length === 0
  );
}

export function assertSealedCfdi40(
  value: unknown,
): asserts value is SealedCfdi40Xml {
  if (!isSealedCfdi40(value))
    throw new Cfdi40Error([
      cfdi40Issue("SEALED_CFDI_REQUIRED", "Comprobante", "ORBIT"),
    ]);
}

/** The only input a PAC adapter may receive (FASE5C3 §AA.0): a sealed, verified CFDI. */
export type Cfdi40PacSubmission = { readonly cfdi: SealedCfdi40Xml };
/** Contract for future PAC adapters: they cannot be called with anything else. */
export interface Cfdi40PacAdapter {
  submit(input: Cfdi40PacSubmission): Promise<unknown>;
}

export function pacSubmission(value: unknown): Cfdi40PacSubmission {
  assertSealedCfdi40(value);
  return { cfdi: value };
}
