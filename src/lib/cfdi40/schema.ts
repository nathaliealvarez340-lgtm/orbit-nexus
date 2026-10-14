import { createHash } from "node:crypto";
import { Cfdi40Error, cfdi40Issue, type Cfdi40Issue } from "./errors";
import { isSealedCfdi40 } from "./sealed";
import { cfdi40Namespace, cfdi40SchemaLocation } from "./serialize";
import { resolveSatXsdImport, type Cfdi40XsdBundle } from "./xsd-resources";
import type { SealedCfdi40Xml, XsdValidatedCfdi40 } from "./types";

// Fase 5C.7: XSD validation gate (FASE5C §15.3 step 4; FASE5C3 §AA.3). The official SAT
// schemas (cfdv40.xsd and its imports, versioned and hash-checked) validate the EXACT bytes
// of a CFDI sealed by ORBIT; the result is XsdValidatedCfdi40, the only thing a PAC adapter
// accepts. A valid Sello does not make the XML XSD-valid, and XSD validity says nothing about
// the Sello, the CSD, catalog validity in context, the SAT error matrix or the PAC: the
// domain validations before the seal stay in force. Any doubt fails closed.
//
// The engine is a port (./xsd-engine.ts wires the approved one). Schemas are compiled once per
// engine and XSD bundle; imports are served only from the verified bundle, and compiling must
// request exactly the declared imports. The XML is never modified, re-serialized or fetched
// from its schemaLocation (that attribute is document metadata, never a permission to fetch).

/** A raw finding of an engine. Its message is engine text: classified, never surfaced. */
export type Cfdi40XsdDiagnostic = {
  stage: "PARSE" | "VALIDATE";
  message: string;
  line: number;
  column: number;
  /** Element path reported by the engine (prefix:name[index] steps), when known. */
  xpath?: string;
};
/**
 * Fase 5C.8: an element as the engine parsed it (namespace URI and local name; attributes
 * without namespace declarations). Read from the same parse that was validated, so a
 * structural comparison never depends on a second parser.
 */
export type Cfdi40XmlNode = {
  readonly namespace: string;
  readonly name: string;
  readonly attributes: readonly {
    readonly namespace: string;
    readonly name: string;
    readonly value: string;
  }[];
  readonly children: readonly Cfdi40XmlNode[];
  /** True when the element holds non-whitespace text (no CFDI 4.0 element does). */
  readonly text: boolean;
};
export interface Cfdi40CompiledXsd {
  /** Parses and validates exactly these bytes; [] means valid. Throws only on engine failure. */
  validate(bytes: Uint8Array): Cfdi40XsdDiagnostic[];
  /** Like validate, and when valid also returns the element tree of that same parse. */
  inspect?(bytes: Uint8Array): {
    diagnostics: Cfdi40XsdDiagnostic[];
    tree: Cfdi40XmlNode | null;
  };
}
/**
 * XSD engine port. The engine parses the root schema itself and loads every import only
 * through `load` (null = refused); it must not read files, use the network, evaluate code or
 * resolve entities or DTDs, and must never modify the XML it validates.
 */
export interface Cfdi40XsdEngine {
  /** Package and version, recorded with each validated CFDI. */
  readonly id: string;
  compile(
    root: { url: string; bytes: Uint8Array },
    load: (url: string) => Uint8Array | null,
  ): Cfdi40CompiledXsd;
}

const fail = (code: Cfdi40Issue["code"], path = "Comprobante") =>
  new Cfdi40Error([cfdi40Issue(code, path, "ORBIT")]);

/** The default until an engine is wired: nothing is validated. */
export const unavailableXsdEngine: Cfdi40XsdEngine = {
  id: "none",
  compile() {
    throw fail("CFDI_XSD_SCHEMA_UNAVAILABLE");
  },
};

/** Every import of the set, transitively, starting at the root: what compiling may load. */
function expectedLoads(bundle: Cfdi40XsdBundle) {
  const expected = new Set<string>();
  const visit = (url: string) => {
    for (const imported of bundle.schemas.get(url)?.imports ?? [])
      if (!expected.has(imported)) {
        expected.add(imported);
        visit(imported);
      }
  };
  visit(bundle.rootUrl);
  return expected;
}

const compiled = new WeakMap<
  Cfdi40XsdEngine,
  Map<string, { bundle: Cfdi40XsdBundle; xsd: Cfdi40CompiledXsd }>
>();
/**
 * The official XSD compiled by an engine, once per engine and XSD set (keyed by the set's
 * hash: another version never reuses it). Fails closed with CFDI_XSD_SCHEMA_INTEGRITY_FAILED
 * when the engine asks for anything but exactly the declared imports, and with
 * CFDI_XSD_SCHEMA_UNAVAILABLE when the engine cannot compile.
 */
export function compileCfdi40Xsd(
  engine: Cfdi40XsdEngine,
  bundle: Cfdi40XsdBundle,
): Cfdi40CompiledXsd {
  let byBundle = compiled.get(engine);
  if (!byBundle) compiled.set(engine, (byBundle = new Map()));
  const cached = byBundle.get(bundle.bundleSha256);
  if (cached && cached.bundle === bundle) return cached.xsd;
  const root = bundle.schemas.get(bundle.rootUrl);
  if (!root) throw fail("CFDI_XSD_SCHEMA_UNAVAILABLE", "XSD/cfdv40.xsd");
  const requested = new Set<string>();
  let refused = false;
  let xsd: Cfdi40CompiledXsd;
  try {
    xsd = engine.compile({ url: root.url, bytes: root.bytes }, (url) => {
      const bytes = resolveSatXsdImport(bundle, url);
      if (bytes) requested.add(url);
      else refused = true;
      return bytes;
    });
  } catch (error) {
    if (error instanceof Cfdi40Error) throw error;
    throw fail("CFDI_XSD_SCHEMA_UNAVAILABLE", "XSD/cfdv40.xsd");
  }
  const expected = expectedLoads(bundle);
  if (
    refused ||
    requested.size !== expected.size ||
    [...expected].some((url) => !requested.has(url))
  )
    throw fail("CFDI_XSD_SCHEMA_INTEGRITY_FAILED", "XSD/cfdv40.xsd");
  byBundle.set(bundle.bundleSha256, { bundle, xsd });
  return xsd;
}

// --- Checks before the engine ---------------------------------------------------------------

const xsiNamespace = "http://www.w3.org/2001/XMLSchema-instance";
/** Namespaces of the supported CFDI 4.0 base (no complements or addenda in ORBIT v1). */
const supportedNamespaces = new Set([cfdi40Namespace, xsiNamespace]);
const declaration = /^(?:﻿)?<\?xml\s[^?<>]*\?>/;

function preflight(xml: string): Cfdi40Issue[] {
  // Data, never instructions: no DOCTYPE/DTD, entities, CDATA, comments or processing
  // instructions anywhere (ORBIT writes none), so nothing can expand or point elsewhere.
  const body = xml.replace(declaration, "");
  if (/<[!?]/.test(body))
    return [
      cfdi40Issue(
        "CFDI_XSD_FORBIDDEN_MARKUP",
        "/cfdi:Comprobante",
        "XSD:MARKUP",
      ),
    ];
  for (const [, uri] of body.matchAll(
    /\sxmlns(?::[A-Za-z_][\w.-]*)?="([^"]*)"/g,
  ))
    if (!supportedNamespaces.has(uri))
      return [
        cfdi40Issue(
          "CFDI_XSD_UNSUPPORTED_NAMESPACE",
          "/cfdi:Comprobante",
          "XSD:NAMESPACE",
        ),
      ];
  // CFDI 4.0 documents carry the standard schemaLocation; it is checked as text and never
  // used to load anything.
  const locations = [
    ...body.matchAll(/\s(?:[A-Za-z_][\w.-]*:)?schemaLocation="([^"]*)"/g),
  ].map((m) => m[1]);
  if (locations.length !== 1 || locations[0] !== cfdi40SchemaLocation)
    return [
      cfdi40Issue(
        "CFDI_XSD_INVALID",
        "/cfdi:Comprobante/@xsi:schemaLocation",
        "XSD:SCHEMA_LOCATION",
      ),
    ];
  return [];
}

// --- Classification of engine findings ------------------------------------------------------

const qname = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;
const safeXPath =
  /^(?:\/[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?(?:\[\d{1,4}\])?){1,12}$/;
const maxIssues = 20;

function classify(diagnostic: Cfdi40XsdDiagnostic): {
  code: Cfdi40Issue["code"];
  kind: string;
} {
  const m = diagnostic.message;
  if (diagnostic.stage === "PARSE")
    return { code: "CFDI_XSD_MALFORMED_XML", kind: "NOT_WELL_FORMED" };
  if (
    /demanded by the strict wildcard|No matching global (element )?declaration available for the validation root/.test(
      m,
    )
  )
    return {
      code: "CFDI_XSD_UNSUPPORTED_NAMESPACE",
      kind: "UNDECLARED_ELEMENT",
    };
  const facet = /\[facet '([A-Za-z]{1,20})'\]/.exec(m);
  if (facet) return { code: "CFDI_XSD_INVALID", kind: "FACET_" + facet[1] };
  const kinds: [RegExp, string][] = [
    [/is required but missing/, "ATTRIBUTE_MISSING"],
    [
      /attribute '[^']*' is not allowed|The attribute .* is not allowed/,
      "ATTRIBUTE_NOT_ALLOWED",
    ],
    [/Missing child element/, "ELEMENT_MISSING"],
    [/This element is not expected/, "ELEMENT_UNEXPECTED"],
    [/fixed value constraint|does not match the fixed value/, "VALUE_FIXED"],
    [/is not a valid value of/, "VALUE_TYPE"],
    [/[Cc]haracter content|text content/, "CONTENT_NOT_ALLOWED"],
  ];
  for (const [pattern, kind] of kinds)
    if (pattern.test(m)) return { code: "CFDI_XSD_INVALID", kind };
  return { code: "CFDI_XSD_INVALID", kind: "SCHEMA_RULE" };
}

/** Engine findings → bounded issues: codes, element/attribute names, positions; no values. */
function issuesOf(diagnostics: readonly Cfdi40XsdDiagnostic[]): Cfdi40Issue[] {
  const issues: Cfdi40Issue[] = [];
  const seen = new Set<string>();
  for (const diagnostic of diagnostics) {
    const { code, kind } = classify(diagnostic);
    const element =
      diagnostic.xpath && safeXPath.test(diagnostic.xpath)
        ? diagnostic.xpath
        : "/cfdi:Comprobante";
    const attribute = /attribute '([^']{1,60})'/.exec(diagnostic.message)?.[1];
    const path =
      attribute && qname.test(attribute) ? `${element}/@${attribute}` : element;
    const type = /atomic type '([^']{1,80})'/.exec(diagnostic.message)?.[1];
    const rule = `XSD:${kind}${type && qname.test(type) ? ":" + type : ""}`;
    const key = `${code} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = Number.isSafeInteger(diagnostic.line) ? diagnostic.line : 0;
    const column = Number.isSafeInteger(diagnostic.column)
      ? diagnostic.column
      : 0;
    issues.push(cfdi40Issue(code, path, rule, { line, column }));
    if (issues.length === maxIssues) break;
  }
  return issues;
}

function inspect(xml: string, bytes: Uint8Array, xsd: Cfdi40CompiledXsd) {
  const early = preflight(xml);
  if (early.length) return early;
  let diagnostics: Cfdi40XsdDiagnostic[];
  try {
    diagnostics = xsd.validate(bytes);
  } catch (error) {
    if (error instanceof Cfdi40Error) throw error;
    throw fail("CFDI_XSD_VALIDATION_FAILED");
  }
  return issuesOf(diagnostics);
}

/**
 * Diagnostics of any CFDI 4.0 XML against the official XSD (tooling and tests): the same
 * checks as the gate, as a list. It never produces an XsdValidatedCfdi40: only a SealedCfdi40Xml
 * registered by ORBIT can become one.
 */
export function cfdi40XsdProblems(
  xml: string,
  dependencies: { engine: Cfdi40XsdEngine; bundle: Cfdi40XsdBundle },
): Cfdi40Issue[] {
  return inspect(
    xml,
    new Uint8Array(Buffer.from(xml, "utf8")),
    compileCfdi40Xsd(dependencies.engine, dependencies.bundle),
  );
}

// --- The gate -------------------------------------------------------------------------------

const validated = new WeakSet<object>();
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Validates the exact bytes of a SealedCfdi40Xml registered by ORBIT against the official
 * XSD set and returns the registered XsdValidatedCfdi40. Throws Cfdi40Error:
 * SEALED_CFDI_REQUIRED, CFDI_XSD_FORBIDDEN_MARKUP, CFDI_XSD_UNSUPPORTED_NAMESPACE,
 * CFDI_XSD_MALFORMED_XML, CFDI_XSD_INVALID (with bounded issues), CFDI_XSD_SCHEMA_UNAVAILABLE,
 * CFDI_XSD_SCHEMA_INTEGRITY_FAILED or CFDI_XSD_VALIDATION_FAILED. Nothing here goes to a PAC.
 */
export function validateSealedCfdi40Xsd(
  sealed: SealedCfdi40Xml,
  dependencies: { engine: Cfdi40XsdEngine; bundle: Cfdi40XsdBundle },
): XsdValidatedCfdi40 {
  if (!isSealedCfdi40(sealed)) throw fail("SEALED_CFDI_REQUIRED");
  const xsd = compileCfdi40Xsd(dependencies.engine, dependencies.bundle);
  // A private copy of the bytes: what was validated is what the result carries.
  const bytes = new Uint8Array(sealed.bytes);
  if (sha256(bytes) !== sealed.sha256) throw fail("SEALED_CFDI_REQUIRED");
  const issues = inspect(sealed.xml, bytes, xsd);
  if (issues.length) throw new Cfdi40Error(issues);
  if (!isSealedCfdi40(sealed) || sha256(bytes) !== sealed.sha256)
    throw fail("SEALED_CFDI_REQUIRED");
  const value = Object.freeze({
    stage: "XSD_VALIDATED",
    xml: sealed.xml,
    bytes,
    sha256: sealed.sha256,
    certificate: sealed.certificate,
    preSealSha256: sealed.preSealSha256,
    originalStringSha256: sealed.originalStringSha256,
    xsd: Object.freeze({
      bundleSha256: dependencies.bundle.bundleSha256,
      engine: dependencies.engine.id,
    }),
  }) as unknown as XsdValidatedCfdi40;
  validated.add(value);
  return value;
}

/** True only for a value produced by validateSealedCfdi40Xsd whose bytes did not change. */
export function isXsdValidatedCfdi40(
  value: unknown,
): value is XsdValidatedCfdi40 {
  if (!value || typeof value !== "object" || !validated.has(value))
    return false;
  const candidate = value as XsdValidatedCfdi40;
  return (
    candidate.stage === "XSD_VALIDATED" &&
    candidate.bytes instanceof Uint8Array &&
    Buffer.from(candidate.bytes).toString("utf8") === candidate.xml &&
    sha256(candidate.bytes) === candidate.sha256
  );
}

/** The only input a PAC adapter may receive (FASE5C3 §AA.0): a sealed, XSD-validated CFDI. */
export type Cfdi40PacSubmission = { readonly cfdi: XsdValidatedCfdi40 };
/** Contract for future PAC adapters: they cannot be called with anything else. */
export interface Cfdi40PacAdapter {
  submit(input: Cfdi40PacSubmission): Promise<unknown>;
}

export function pacSubmission(value: unknown): Cfdi40PacSubmission {
  if (!isXsdValidatedCfdi40(value)) throw fail("XSD_VALIDATED_CFDI_REQUIRED");
  return { cfdi: value };
}
