import { X509Certificate, createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { certificateNumberFromSerial } from "@/lib/csd/certificate-number";
import { verifyCfdiSeal } from "@/lib/csd/signing";
import { Cfdi40Error, cfdi40Issue, type Cfdi40IssueCode } from "./errors";
import {
  isCfdi40OriginalString,
  type Cfdi40CompiledXslt,
} from "./original-string";
import { isPreSealCfdi40, serializeSealedCfdi40 } from "./serialize";
import type {
  Cfdi40CertificateBinding,
  Cfdi40OriginalString,
  PreSealCfdi40Xml,
  SealedCfdi40Xml,
} from "./types";

// Fase 5C.4/5C.6: the only door from "CFDI" to "XSD validation" or "PAC". Two locks:
// 1. Compile time: SealedCfdi40Xml carries a type-only brand that no value can have, so an
//    UnsignedCfdi40Xml, a PreSealCfdi40Xml or an object literal is not assignable to it.
// 2. Runtime: a value counts as sealed only if createSealedCfdi40 registered it in this
//    module (WeakSet, not exported) AND it is still consistent. createSealedCfdi40 registers
//    nothing unless the Sello verifies cryptographically (FASE5C §16.4): over the cadena
//    that was signed, and over the cadena recomputed with the official XSLT from the final
//    XML, with the certificate written in it. Well-formed forgeries are rejected.

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

export type SealedXmlProblem =
  | SealAttributeProblem
  /** The official XSLT could not produce a cadena original from the XML. */
  | "CADENA_ORIGINAL_UNAVAILABLE"
  /** The Sello is not an RSA-SHA256 PKCS#1 v1.5 signature of that cadena by Certificado. */
  | "SELLO_NOT_VERIFIED";

const cadenaShape = /^\|\|[^\r\n]*\|\|$/;

function inspectSealedXml(
  xml: string,
  stylesheet: Cfdi40CompiledXslt,
  binding?: Cfdi40CertificateBinding,
): { problems: SealedXmlProblem[]; cadena: string | null } {
  const problems: SealedXmlProblem[] = sealAttributeProblems(xml, binding);
  let cadena: string | null = null;
  try {
    const value = stylesheet.transformToText(xml);
    cadena =
      typeof value === "string" && cadenaShape.test(value) ? value : null;
  } catch {
    cadena = null;
  }
  if (cadena === null)
    return { problems: [...problems, "CADENA_ORIGINAL_UNAVAILABLE"], cadena };
  let attrs: Record<string, unknown> = {};
  try {
    const root = (parser.parse(xml) as Record<string, unknown>)[
      "cfdi:Comprobante"
    ];
    if (root && typeof root === "object")
      attrs = root as Record<string, unknown>;
  } catch {
    // Already reported by sealAttributeProblems.
  }
  const seal = decode(typeof attrs.Sello === "string" ? attrs.Sello : "");
  const der = decode(
    typeof attrs.Certificado === "string" ? attrs.Certificado : "",
  );
  let verified = false;
  try {
    verified =
      !!seal &&
      !!der &&
      verifyCfdiSeal(
        new X509Certificate(der).publicKey,
        Buffer.from(cadena, "utf8"),
        seal,
      );
  } catch {
    verified = false;
  }
  if (!verified) problems.push("SELLO_NOT_VERIFIED");
  return { problems, cadena };
}

/**
 * FASE5C §16.4 for any sealed XML, as a PAC would check it: structural seal attributes, the
 * cadena original recomputed from the XML itself with the official XSLT, and the Sello
 * verified over that cadena with the Certificado written in the XML. An empty list means
 * the XML has not changed since it was sealed. It does not register anything.
 */
export function sealedCfdi40XmlProblems(
  xml: string,
  stylesheet: Cfdi40CompiledXslt,
  binding?: Cfdi40CertificateBinding,
): SealedXmlProblem[] {
  return inspectSealedXml(xml, stylesheet, binding).problems;
}

const sealFailure = (code: Cfdi40IssueCode, path = "Comprobante/@Sello") =>
  new Cfdi40Error([cfdi40Issue(code, path, "ORBIT")]);

/**
 * Fase 5C.6: the ONLY constructor of SealedCfdi40Xml. Built exclusively from the pre-seal
 * XML and a Sello: the Sello must verify over the cadena it was computed from (generated by
 * ORBIT from this very pre-seal XML); the XML is that pre-seal tree with Sello added and
 * nothing recomputed; and the final XML must verify on its own (cadena recomputed with the
 * official XSLT equal to the signed one, Sello valid with its Certificado). Any failure
 * throws CFDI_SEAL_VERIFICATION_FAILED and nothing is registered.
 */
export function createSealedCfdi40(
  preSeal: PreSealCfdi40Xml,
  originalString: Cfdi40OriginalString,
  sello: string,
  stylesheet: Cfdi40CompiledXslt,
): SealedCfdi40Xml {
  if (!isPreSealCfdi40(preSeal))
    throw sealFailure("PRE_SEAL_CFDI_REQUIRED", "Comprobante");
  if (
    !isCfdi40OriginalString(originalString) ||
    originalString.preSealSha256 !== preSeal.sha256 ||
    originalString.noCertificado !== preSeal.certificate.noCertificado
  )
    throw sealFailure("ORIGINAL_STRING_INVALID", "CadenaOriginal");
  const der = decode(preSeal.certificate.certificadoBase64);
  const seal = decode(sello);
  let verified = false;
  try {
    verified =
      !!der &&
      !!seal &&
      verifyCfdiSeal(
        new X509Certificate(der).publicKey,
        originalString.bytes,
        seal,
      );
  } catch {
    verified = false;
  }
  if (!verified) throw sealFailure("CFDI_SEAL_VERIFICATION_FAILED");
  const written = serializeSealedCfdi40(preSeal, sello);
  const { problems, cadena } = inspectSealedXml(
    written.xml,
    stylesheet,
    preSeal.certificate,
  );
  if (problems.length || cadena !== originalString.value)
    throw sealFailure("CFDI_SEAL_VERIFICATION_FAILED");
  const value = Object.freeze({
    stage: "SEALED",
    ...written,
    certificate: preSeal.certificate,
    preSealSha256: preSeal.sha256,
    originalStringSha256: originalString.sha256,
  }) as unknown as SealedCfdi40Xml;
  registry.add(value);
  return value;
}

/** True only for a CFDI registered by createSealedCfdi40 and unchanged since. */
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
