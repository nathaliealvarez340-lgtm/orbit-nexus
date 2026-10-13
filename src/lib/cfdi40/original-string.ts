import { createHash } from "node:crypto";
import { Cfdi40Error, cfdi40Issue, type Cfdi40IssueCode } from "./errors";
import { isPreSealCfdi40 } from "./serialize";
import { resolveSatXsltInclude, type Cfdi40XsltBundle } from "./xslt-resources";
import type { Cfdi40OriginalString, PreSealCfdi40Xml } from "./types";

// Fase 5C.5: cadena original = the official SAT XSLT (cadenaoriginal_4_0.xslt and its
// includes, versioned and hash-checked) executed on the pre-seal XML (FASE5C3 §AA.4). ORBIT
// never reimplements the XSLT rules. The engine is a port: until a dependency is approved
// (FASE5C3 §AA.5.3, docs/tasks/FASE5C5-CADENA-ORIGINAL.md) the default engine is
// unavailable and every request fails closed. Pure: no database, network, files or clock.

const fail = (code: Cfdi40IssueCode) =>
  new Cfdi40Error([cfdi40Issue(code, "CadenaOriginal", "ORBIT")]);

/** A compiled stylesheet; the transformation result must be returned verbatim. */
export interface Cfdi40CompiledXslt {
  transformToText(xml: string): string;
}
/**
 * XSLT engine port. An engine loads xsl:include/xsl:import only through `loadInclude`
 * (which serves the verified official texts), and never reads files, calls the network,
 * evaluates code or runs processes.
 */
export interface Cfdi40XsltEngine {
  /** Package and version, recorded with each cadena (e.g. "@tradik/xslt-processor@1.3.4"). */
  readonly id: string;
  compile(
    stylesheet: { url: string; text: string },
    loadInclude: (href: string) => string,
  ): Cfdi40CompiledXslt;
}

/** The default until an engine passes the dependency gate: nothing is generated. */
export const unavailableXsltEngine: Cfdi40XsltEngine = {
  id: "none",
  compile() {
    throw fail("XSLT_ENGINE_UNAVAILABLE");
  },
};

const bom = String.fromCharCode(0xfeff);
/** A leading BOM is the encoding signature of some SAT files, not stylesheet content. */
const withoutBom = (text: string) =>
  text.startsWith(bom) ? text.slice(1) : text;

const compiled = new WeakMap<
  Cfdi40XsltEngine,
  WeakMap<Cfdi40XsltBundle, Cfdi40CompiledXslt>
>();
/**
 * The official XSLT compiled by an engine, once per engine and bundle: root and includes
 * only from the verified bundle, through the allowlist, without the BOM signature.
 */
export function compileCfdi40Xslt(
  engine: Cfdi40XsltEngine,
  bundle: Cfdi40XsltBundle,
): Cfdi40CompiledXslt {
  let byBundle = compiled.get(engine);
  if (!byBundle) compiled.set(engine, (byBundle = new WeakMap()));
  const cached = byBundle.get(bundle);
  if (cached) return cached;
  // The loader's own coded error wins over however the engine wraps it.
  let refused: Cfdi40Error | null = null;
  let stylesheet: Cfdi40CompiledXslt;
  try {
    stylesheet = engine.compile(
      { url: bundle.rootUrl, text: withoutBom(bundle.root) },
      (href) => {
        try {
          return withoutBom(resolveSatXsltInclude(bundle, href));
        } catch (error) {
          if (error instanceof Cfdi40Error) refused = error;
          throw error;
        }
      },
    );
  } catch (error) {
    if (refused) throw refused;
    if (error instanceof Cfdi40Error) throw error;
    throw fail("XSLT_TRANSFORM_FAILED");
  }
  byBundle.set(bundle, stylesheet);
  return stylesheet;
}

/** "||" + fields separated by "|" + "||", on one line (the SAT XSLT normalizes spaces). */
const originalStringShape = /^\|\|[^\r\n]*\|\|$/;

/**
 * The cadena original of a pre-seal CFDI, exactly as the official XSLT produces it: no
 * trimming, normalization or re-encoding. Throws PRE_SEAL_CFDI_REQUIRED for anything not
 * produced by serializePreSealCfdi40, and fails closed on any engine, resource or shape
 * problem. Errors carry codes only, never the XML or the cadena.
 */
export function generateCfdi40OriginalString(
  xml: PreSealCfdi40Xml,
  dependencies: { engine: Cfdi40XsltEngine; bundle: Cfdi40XsltBundle },
): Cfdi40OriginalString {
  if (!isPreSealCfdi40(xml)) throw fail("PRE_SEAL_CFDI_REQUIRED");
  const stylesheet = compileCfdi40Xslt(
    dependencies.engine,
    dependencies.bundle,
  );
  let value: unknown;
  try {
    value = stylesheet.transformToText(xml.xml);
  } catch (error) {
    if (error instanceof Cfdi40Error) throw error;
    throw fail("XSLT_TRANSFORM_FAILED");
  }
  if (
    typeof value !== "string" ||
    !originalStringShape.test(value) ||
    !value.includes(`|${xml.certificate.noCertificado}|`)
  )
    throw fail("ORIGINAL_STRING_INVALID");
  const bytes = new Uint8Array(Buffer.from(value, "utf8"));
  return Object.freeze({
    stage: "ORIGINAL_STRING",
    value,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    preSealSha256: xml.sha256,
    noCertificado: xml.certificate.noCertificado,
    xslt: Object.freeze({
      rootSha256: dependencies.bundle.rootSha256,
      engine: dependencies.engine.id,
    }),
  }) as unknown as Cfdi40OriginalString;
}

/** A DOMParser that throws on malformed XML (xmldom: onError rethrows errors). */
export type XmlDomParser = {
  parseFromString(text: string, type: string): unknown;
};
/** The members of @tradik/xslt-processor the adapter uses; no import of the package. */
export type TradikXsltModule = {
  XsltEngine: new (options: {
    domParser: XmlDomParser;
    stylesheetLoader: (href: string, baseUri?: string) => string;
    documentLoader: (uri: string, baseUri?: string) => string;
  }) => {
    importStylesheet(stylesheet: unknown, stylesheetUri?: string): void;
    transformToString(source: unknown): string;
  };
};

/**
 * Adapter for @tradik/xslt-processor (candidate, NOT approved: see the dependency gate).
 * Its XsltEngine runs the version="2.0" SAT stylesheets with the XSLT 1.0 engine in
 * forwards-compatible mode; includes come only from `loadInclude` and document() is
 * refused. Wiring it needs the dependency in package.json, which this phase does not add.
 */
export function tradikXsltEngine(
  module: TradikXsltModule,
  domParser: XmlDomParser,
  id: string,
): Cfdi40XsltEngine {
  return {
    id,
    compile(stylesheet, loadInclude) {
      const engine = new module.XsltEngine({
        domParser,
        stylesheetLoader: (href) => loadInclude(href),
        documentLoader: () => {
          throw fail("SAT_XSLT_RESOURCE_NOT_ALLOWED");
        },
      });
      engine.importStylesheet(
        domParser.parseFromString(stylesheet.text, "text/xml"),
        stylesheet.url,
      );
      return {
        transformToText: (xml) =>
          engine.transformToString(domParser.parseFromString(xml, "text/xml")),
      };
    },
  };
}
