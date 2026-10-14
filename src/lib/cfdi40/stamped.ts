import { createHash } from "node:crypto";
import type { PacStampEvidence } from "@/lib/pac/types";
import type { Cfdi40CompiledXslt, Cfdi40XsltEngine } from "./original-string";
import {
  isXsdValidatedCfdi40,
  type Cfdi40XmlNode,
  type Cfdi40XsdEngine,
} from "./schema";
import {
  compileStampedCfdi40Xsd,
  type StampedCfdi40XsdSet,
} from "./stamped-schema";
import { cfdi40Namespace } from "./serialize";
import {
  tfd11SchemaLocation,
  tfdNamespace,
  type Tfd11Bundle,
} from "./tfd-resources";
import { serializeXml } from "./xml";
import type { StampedCfdi40, XsdValidatedCfdi40 } from "./types";

// Fase 5C.8: verification of a PAC response against the CFDI ORBIT sent (docs/tasks/
// FASE5C8-PAC-SANDBOX.md §14-20). Nothing the PAC returns is trusted:
// 1. the stamped XML has no DTD, entities, comments, CDATA or PIs and only the cfdi, xsi and
//    tfd namespaces; it is valid against the official cfdv40.xsd + TimbreFiscalDigitalv11.xsd
//    set (./stamped-schema.ts), parsed once by the approved engine (no regex over XML);
// 2. its tree equals the tree of the bytes sent (every element, attribute and value, Sello,
//    NoCertificado, Certificado, amounts, RFCs, Fecha, concepts) except for exactly one added
//    cfdi:Complemento holding exactly one tfd:TimbreFiscalDigital and nothing else;
// 3. the TFD is 1.1 with a valid UUID, FechaTimbrado, RfcProvCertif, NoCertificadoSAT and
//    SelloSAT, and its SelloCFD is the Sello sent (binding TFD ↔ CFDI);
// 4. every parallel field of the PAC (uuid, selloCFDI, selloSAT, noCertificadoSAT,
//    noCertificadoCFDI, fechaTimbrado, cadenaOriginalSAT, a standalone tfd) matches the TFD,
//    and the TFD cadena original is produced with the official SAT XSLT.
// The SelloSAT is NOT verified cryptographically: there is no trusted source of the SAT
// certificate in this phase (pending gate TFD_SAT_SEAL_VERIFIED). Errors carry a problem code
// only: never the XML, a Sello, an RFC or an amount.

export type StampedCfdiProblem =
  | "SENT_CFDI_REQUIRED"
  | "STAMPED_CFDI_MISSING"
  | "STAMPED_CFDI_TOO_LARGE"
  | "STAMPED_CFDI_ENCODING"
  | "STAMPED_CFDI_FORBIDDEN_MARKUP"
  | "STAMPED_CFDI_UNSUPPORTED_NAMESPACE"
  | "STAMPED_CFDI_MALFORMED"
  | "STAMPED_CFDI_XSD_INVALID"
  | "STAMPED_CFDI_CONTENT_CHANGED"
  | "TFD_MISSING"
  | "TFD_UNEXPECTED_CONTENT"
  | "TFD_VERSION"
  | "TFD_UUID_INVALID"
  | "TFD_SELLO_CFD_MISMATCH"
  | "TFD_NO_CERTIFICADO_SAT_INVALID"
  | "TFD_FECHA_INVALID"
  | "TFD_RFC_PROV_CERTIF_INVALID"
  | "TFD_SELLO_SAT_INVALID"
  | "TFD_CADENA_UNAVAILABLE"
  | "TFD_CADENA_MISMATCH"
  | "PAC_FIELDS_MISMATCH";

export class StampedCfdiError extends Error {
  constructor(public readonly problem: StampedCfdiProblem) {
    super(problem);
    this.name = "StampedCfdiError";
  }
}

export type StampedVerificationDeps = {
  readonly engine: Cfdi40XsdEngine;
  readonly set: StampedCfdi40XsdSet;
  readonly xslt: {
    readonly engine: Cfdi40XsltEngine;
    readonly tfd: Tfd11Bundle;
  };
};

export const maxStampedCfdiBytes = 4 * 1024 * 1024;
const xsiNamespace = "http://www.w3.org/2001/XMLSchema-instance";
const allowedNamespaces = new Set([
  cfdi40Namespace,
  xsiNamespace,
  tfdNamespace,
]);
const declaration = /^(?:﻿)?<\?xml\s[^?<>]*\?>/;
const uuidShape =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const base64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const tfdAttributes = new Set([
  "Version",
  "UUID",
  "FechaTimbrado",
  "RfcProvCertif",
  "Leyenda",
  "SelloCFD",
  "NoCertificadoSAT",
  "SelloSAT",
]);

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const fail = (problem: StampedCfdiProblem): never => {
  throw new StampedCfdiError(problem);
};

/** Text-level refusal of markup that must never reach a parser (never used to read data). */
function preflight(bytes: Uint8Array) {
  if (bytes.byteLength > maxStampedCfdiBytes) fail("STAMPED_CFDI_TOO_LARGE");
  let text = "";
  try {
    // ignoreBOM keeps a leading BOM in the text, so text and bytes stay the same document.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    fail("STAMPED_CFDI_ENCODING");
  }
  const body = text.replace(declaration, "");
  if (/<[!?]/.test(body)) fail("STAMPED_CFDI_FORBIDDEN_MARKUP");
  for (const [, uri] of body.matchAll(
    /\sxmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*["']([^"']*)["']/g,
  ))
    if (!allowedNamespaces.has(uri)) fail("STAMPED_CFDI_UNSUPPORTED_NAMESPACE");
  return text;
}

function parse(
  xsd: ReturnType<typeof compileStampedCfdi40Xsd>,
  bytes: Uint8Array,
) {
  const { diagnostics, tree } = xsd.inspect(bytes);
  if (diagnostics.length)
    fail(
      diagnostics.some((d) => d.stage === "PARSE")
        ? "STAMPED_CFDI_MALFORMED"
        : "STAMPED_CFDI_XSD_INVALID",
    );
  return tree ?? fail("STAMPED_CFDI_MALFORMED");
}

const keyOf = (node: Cfdi40XmlNode) => `{${node.namespace}}${node.name}`;
const attributesOf = (node: Cfdi40XmlNode) =>
  node.attributes
    .map((a) => `{${a.namespace}}${a.name}\u0000${a.value}`)
    .sort()
    .join("\u0001");
function sameTree(a: Cfdi40XmlNode, b: Cfdi40XmlNode): boolean {
  return (
    keyOf(a) === keyOf(b) &&
    a.text === b.text &&
    attributesOf(a) === attributesOf(b) &&
    a.children.length === b.children.length &&
    a.children.every((child, i) => sameTree(child, b.children[i]))
  );
}
const attribute = (node: Cfdi40XmlNode, name: string, namespace = "") =>
  node.attributes.find((a) => a.name === name && a.namespace === namespace)
    ?.value ?? null;

type TfdValues = {
  version: string;
  uuid: string;
  fechaTimbrado: string;
  rfcProvCertif: string;
  leyenda: string | null;
  selloCFD: string;
  noCertificadoSAT: string;
  selloSAT: string;
};

function validDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

/** The TFD node: only the TFD 1.1 attributes (and its standard schemaLocation), all valid. */
function readTfd(node: Cfdi40XmlNode, sentSello: string): TfdValues {
  if (keyOf(node) !== `{${tfdNamespace}}TimbreFiscalDigital`)
    fail("TFD_MISSING");
  if (node.children.length || node.text) fail("TFD_UNEXPECTED_CONTENT");
  for (const a of node.attributes) {
    const known =
      (a.namespace === "" && tfdAttributes.has(a.name)) ||
      (a.namespace === xsiNamespace &&
        a.name === "schemaLocation" &&
        a.value.replace(/\s+/g, " ").trim() === tfd11SchemaLocation);
    if (!known) fail("TFD_UNEXPECTED_CONTENT");
  }
  const value = (name: string) => attribute(node, name) ?? "";
  const tfd: TfdValues = {
    version: value("Version"),
    uuid: value("UUID"),
    fechaTimbrado: value("FechaTimbrado"),
    rfcProvCertif: value("RfcProvCertif"),
    leyenda: attribute(node, "Leyenda"),
    selloCFD: value("SelloCFD"),
    noCertificadoSAT: value("NoCertificadoSAT"),
    selloSAT: value("SelloSAT"),
  };
  if (tfd.version !== "1.1") fail("TFD_VERSION");
  if (!uuidShape.test(tfd.uuid) || /^[0-]+$/.test(tfd.uuid))
    fail("TFD_UUID_INVALID");
  if (!sentSello || tfd.selloCFD !== sentSello) fail("TFD_SELLO_CFD_MISMATCH");
  if (!/^[0-9]{20}$/.test(tfd.noCertificadoSAT))
    fail("TFD_NO_CERTIFICADO_SAT_INVALID");
  if (!validDateTime(tfd.fechaTimbrado)) fail("TFD_FECHA_INVALID");
  if (!/^[A-ZÑ&]{3}[0-9]{6}[A-Z0-9]{3}$/.test(tfd.rfcProvCertif))
    fail("TFD_RFC_PROV_CERTIF_INVALID");
  const seal = base64.test(tfd.selloSAT)
    ? Buffer.from(tfd.selloSAT, "base64")
    : null;
  if (
    !seal ||
    seal.length < 128 ||
    seal.length > 1024 ||
    seal.every((byte) => byte === seal[0])
  )
    fail("TFD_SELLO_SAT_INVALID");
  return tfd;
}

// --- TFD cadena original (official cadenaoriginal_TFD_1_1.xslt) ---------------------------------

const stylesheets = new WeakMap<
  Cfdi40XsltEngine,
  WeakMap<Tfd11Bundle, Cfdi40CompiledXslt>
>();
function tfdStylesheet(engine: Cfdi40XsltEngine, bundle: Tfd11Bundle) {
  let byBundle = stylesheets.get(engine);
  if (!byBundle) stylesheets.set(engine, (byBundle = new WeakMap()));
  let compiled = byBundle.get(bundle);
  if (!compiled) {
    compiled = engine.compile(
      { url: bundle.xslt.url, text: bundle.xslt.text },
      () => {
        // The official TFD stylesheet includes nothing; any request is refused.
        throw new StampedCfdiError("TFD_CADENA_UNAVAILABLE");
      },
    );
    byBundle.set(bundle, compiled);
  }
  return compiled;
}

/** The TFD cadena original, from a standalone TFD document written by ORBIT's XML writer. */
function tfdCadena(tfd: TfdValues, deps: StampedVerificationDeps) {
  const document = serializeXml({
    name: "tfd:TimbreFiscalDigital",
    attributes: [
      ["xmlns:tfd", tfdNamespace],
      ["Version", tfd.version],
      ["UUID", tfd.uuid],
      ["FechaTimbrado", tfd.fechaTimbrado],
      ["RfcProvCertif", tfd.rfcProvCertif],
      ...(tfd.leyenda !== null ? [["Leyenda", tfd.leyenda] as const] : []),
      ["SelloCFD", tfd.selloCFD],
      ["NoCertificadoSAT", tfd.noCertificadoSAT],
      ["SelloSAT", tfd.selloSAT],
    ],
    children: [],
  });
  let cadena: unknown;
  try {
    cadena = tfdStylesheet(deps.xslt.engine, deps.xslt.tfd).transformToText(
      document,
    );
  } catch {
    cadena = null;
  }
  if (
    typeof cadena !== "string" ||
    !/^\|\|1\.1\|[^\r\n]*\|\|$/.test(cadena) ||
    !cadena.endsWith(`|${tfd.selloCFD}|${tfd.noCertificadoSAT}||`)
  )
    fail("TFD_CADENA_UNAVAILABLE");
  return cadena as string;
}

/** Each parallel PAC field present must equal the TFD (UUID compared case-insensitively). */
function checkFields(
  evidence: PacStampEvidence,
  tfd: TfdValues,
  noCertificado: string,
  cadena: string,
) {
  const f = evidence.fields;
  if (f.uuid !== undefined && f.uuid.toLowerCase() !== tfd.uuid.toLowerCase())
    fail("PAC_FIELDS_MISMATCH");
  const pairs: [string | undefined, string][] = [
    [f.selloCFDI, tfd.selloCFD],
    [f.selloSAT, tfd.selloSAT],
    [f.noCertificadoSAT, tfd.noCertificadoSAT],
    [f.noCertificadoCFDI, noCertificado],
    [f.fechaTimbrado, tfd.fechaTimbrado],
  ];
  for (const [reported, actual] of pairs)
    if (reported !== undefined && reported !== actual)
      fail("PAC_FIELDS_MISMATCH");
  if (f.cadenaOriginalSAT !== undefined && f.cadenaOriginalSAT !== cadena)
    fail("TFD_CADENA_MISMATCH");
}

function sentTree(sent: XsdValidatedCfdi40, deps: StampedVerificationDeps) {
  if (!isXsdValidatedCfdi40(sent)) fail("SENT_CFDI_REQUIRED");
  const xsd = compileStampedCfdi40Xsd(deps.engine, deps.set);
  const { diagnostics, tree } = xsd.inspect(new Uint8Array(sent.bytes));
  if (diagnostics.length || !tree) fail("SENT_CFDI_REQUIRED");
  const sello = attribute(tree!, "Sello");
  const noCertificado = attribute(tree!, "NoCertificado");
  if (!sello || !noCertificado) fail("SENT_CFDI_REQUIRED");
  return { xsd, tree: tree!, sello: sello!, noCertificado: noCertificado! };
}

const registry = new WeakSet<object>();

/**
 * Verifies a PAC response against the exact CFDI sent and returns the registered
 * StampedCfdi40, or throws StampedCfdiError with a problem code. Requires the complete
 * stamped CFDI (a TFD or a UUID alone is never enough to call a CFDI stamped).
 */
export function verifyStampedCfdi40(
  sent: XsdValidatedCfdi40,
  evidence: PacStampEvidence,
  deps: StampedVerificationDeps,
): StampedCfdi40 {
  const origin = sentTree(sent, deps);
  if (!evidence?.cfdi?.byteLength) fail("STAMPED_CFDI_MISSING");
  const bytes = new Uint8Array(evidence.cfdi!);
  const xml = preflight(bytes);
  const stamped = parse(origin.xsd, bytes);

  // Fiscal content: identical to what was sent, plus exactly one Complemento with the TFD.
  const complementKey = `{${cfdi40Namespace}}Complemento`;
  const complements = stamped.children.filter(
    (c) => keyOf(c) === complementKey,
  );
  if (origin.tree.children.some((c) => keyOf(c) === complementKey))
    fail("STAMPED_CFDI_CONTENT_CHANGED");
  if (complements.length !== 1) fail("TFD_MISSING");
  const rest = stamped.children.filter((c) => keyOf(c) !== complementKey);
  if (
    keyOf(stamped) !== keyOf(origin.tree) ||
    stamped.text !== origin.tree.text ||
    attributesOf(stamped) !== attributesOf(origin.tree) ||
    rest.length !== origin.tree.children.length ||
    !rest.every((child, i) => sameTree(child, origin.tree.children[i]))
  )
    fail("STAMPED_CFDI_CONTENT_CHANGED");
  const [complement] = complements;
  if (complement.attributes.length || complement.text)
    fail("TFD_UNEXPECTED_CONTENT");
  if (complement.children.length !== 1) fail("TFD_UNEXPECTED_CONTENT");

  const tfd = readTfd(complement.children[0], origin.sello);
  // A standalone TFD returned alongside must be that same TFD.
  if (evidence.tfd?.byteLength) {
    preflight(evidence.tfd);
    const standalone = parse(origin.xsd, new Uint8Array(evidence.tfd));
    const own = (node: Cfdi40XmlNode) =>
      node.attributes
        .filter((a) => a.namespace === "")
        .map((a) => `${a.name}\u0000${a.value}`)
        .sort()
        .join("\u0001");
    if (
      keyOf(standalone) !== keyOf(complement.children[0]) ||
      own(standalone) !== own(complement.children[0])
    )
      fail("PAC_FIELDS_MISMATCH");
  }
  const cadena = tfdCadena(tfd, deps);
  checkFields(evidence, tfd, origin.noCertificado, cadena);

  const value = Object.freeze({
    stage: "STAMPED",
    xml,
    bytes,
    sha256: sha256(bytes),
    sentSha256: sent.sha256,
    uuid: tfd.uuid.toLowerCase(),
    tfd: Object.freeze({
      version: "1.1" as const,
      uuid: tfd.uuid,
      fechaTimbrado: tfd.fechaTimbrado,
      rfcProvCertif: tfd.rfcProvCertif,
      noCertificadoSAT: tfd.noCertificadoSAT,
      leyenda: tfd.leyenda,
    }),
    tfdCadenaOriginalSha256: sha256(cadena),
    satSealVerified: false as const,
    xsd: Object.freeze({
      setSha256: deps.set.setSha256,
      engine: deps.engine.id,
    }),
  }) as unknown as StampedCfdi40;
  registry.add(value);
  return value;
}

/**
 * A standalone TFD (e.g. a duplicate CustomID answered without the CFDI) checked against the
 * CFDI sent: valid TFD 1.1 bound to its Sello. Evidence for reconciliation only; it never
 * makes a CFDI stamped. Returns the UUID in canonical lowercase.
 */
export function verifyTfdForSentCfdi40(
  sent: XsdValidatedCfdi40,
  tfdBytes: Uint8Array,
  deps: StampedVerificationDeps,
): { uuid: string } {
  const origin = sentTree(sent, deps);
  preflight(tfdBytes);
  const node = parse(origin.xsd, new Uint8Array(tfdBytes));
  const tfd = readTfd(node, origin.sello);
  return { uuid: tfd.uuid.toLowerCase() };
}

/** True only for a value produced by verifyStampedCfdi40 whose bytes did not change. */
export function isStampedCfdi40(value: unknown): value is StampedCfdi40 {
  if (!value || typeof value !== "object" || !registry.has(value)) return false;
  const candidate = value as StampedCfdi40;
  return (
    candidate.stage === "STAMPED" &&
    candidate.bytes instanceof Uint8Array &&
    Buffer.from(candidate.bytes).toString("utf8") === candidate.xml &&
    sha256(candidate.bytes) === candidate.sha256
  );
}
