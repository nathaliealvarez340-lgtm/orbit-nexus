import "server-only";
import { XsltEngine } from "@tradik/xslt-processor";
import { DOMParser } from "@xmldom/xmldom";
import {
  generateCfdi40OriginalString,
  tradikXsltEngine,
  type TradikXsltModule,
  type XmlDomParser,
} from "./original-string";
import { loadCfdi40XsltBundle } from "./xslt-resources";
import type { Cfdi40OriginalString, PreSealCfdi40Xml } from "./types";

// Fase 5C.5: the approved XSLT engine (docs/tasks/FASE5C5-CADENA-ORIGINAL.md §6), pinned to
// exact versions; tests/cfdi40-engine-guard.test.ts fails on any other version, so an update
// needs a new audit. Only the synchronous XsltEngine is used: the library's asynchronous
// loader (fetch) never runs, xsl:include/xsl:import come only from the verified bundle
// through the allowlist, and document() is refused. Nothing is logged: the DOM parser's
// default handler (console.error) is replaced, and a parse error aborts.

export const cfdi40XsltEngineId =
  "@tradik/xslt-processor@1.3.4 (@xmldom/xmldom@0.9.12)";

class XmlParseError extends Error {
  constructor() {
    super("XML_PARSE_FAILED");
    this.name = "XmlParseError";
  }
}
const domParser = new DOMParser({
  onError(level) {
    if (level !== "warning") throw new XmlParseError();
  },
});

/** The approved engine behind the Cfdi40XsltEngine port (types are structural). */
export const cfdi40XsltEngine = tradikXsltEngine(
  { XsltEngine } as unknown as TradikXsltModule,
  domParser as unknown as XmlDomParser,
  cfdi40XsltEngineId,
);

/**
 * The production cadena original: the official SAT XSLT (versioned, hash-verified bundle)
 * executed by the approved engine on a pre-seal CFDI produced by ORBIT. Pure apart from
 * loading the bundled resources once: no database, network, files or private key.
 */
export async function generateOfficialCfdi40OriginalString(
  xml: PreSealCfdi40Xml,
): Promise<Cfdi40OriginalString> {
  return generateCfdi40OriginalString(xml, {
    engine: cfdi40XsltEngine,
    bundle: await loadCfdi40XsltBundle(),
  });
}
