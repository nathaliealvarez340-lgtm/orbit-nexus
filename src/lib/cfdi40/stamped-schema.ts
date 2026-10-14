import { createHash } from "node:crypto";
import { Cfdi40Error, cfdi40Issue } from "./errors";
import type { Cfdi40CompiledXsd, Cfdi40XsdEngine } from "./schema";
import { cfdi40Namespace } from "./serialize";
import { tfd11XsdUrl, tfdNamespace, type Tfd11Bundle } from "./tfd-resources";
import {
  cfdi40XsdRootUrl,
  isOfficialSatXsdLocation,
  type Cfdi40XsdBundle,
} from "./xsd-resources";

// Fase 5C.8: the XSD set of a STAMPED CFDI 4.0 (docs/tasks/FASE5C8-PAC-SANDBOX.md §19).
// cfdv40.xsd declares Complemento as a strict xs:any, so a stamped CFDI is valid only when the
// TimbreFiscalDigital 1.1 declaration is part of the same schema set. ORBIT therefore
// compiles a fixed wrapper root that contains no rules at all, only the two official imports
// (cfdv40.xsd and TimbreFiscalDigitalv11.xsd); every schema it loads comes from the verified
// bundles through the same closed resolver as Fase 5C.7, and compiling must request exactly
// cfdv40, catCFDI, tdCFDI and the TFD schema. The wrapper text is fixed here and hashed into
// the set fingerprint.

export const stampedXsdWrapperUrl = "urn:orbit:xsd:cfdi40-tfd11";
const wrapperText =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n' +
  `  <xs:import namespace="${cfdi40Namespace}" schemaLocation="${cfdi40XsdRootUrl}"/>\n` +
  `  <xs:import namespace="${tfdNamespace}" schemaLocation="${tfd11XsdUrl}"/>\n` +
  "</xs:schema>\n";

type SchemaEntry = {
  readonly bytes: Uint8Array;
  readonly imports: readonly string[];
  readonly sha256: string;
};
export type StampedCfdi40XsdSet = {
  /** SHA-256 over the sorted "url sha256" lines of every schema and the wrapper. */
  readonly setSha256: string;
  readonly wrapper: {
    readonly url: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  };
  /** Allowlist: official URL → schema. */
  readonly schemas: ReadonlyMap<string, SchemaEntry>;
};

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const fail = (
  code: "CFDI_XSD_SCHEMA_UNAVAILABLE" | "CFDI_XSD_SCHEMA_INTEGRITY_FAILED",
) => new Cfdi40Error([cfdi40Issue(code, "XSD/cfdv40+tfd11", "ORBIT")]);

/** The stamped-CFDI set from the two verified bundles; the TFD may import only CFDI schemas. */
export function stampedCfdi40XsdSet(
  cfdi: Cfdi40XsdBundle,
  tfd: Tfd11Bundle,
): StampedCfdi40XsdSet {
  const schemas = new Map<string, SchemaEntry>();
  for (const [url, schema] of cfdi.schemas)
    schemas.set(url, {
      bytes: schema.bytes,
      imports: schema.imports,
      sha256: schema.sha256,
    });
  if (!schemas.has(cfdi40XsdRootUrl) || schemas.has(tfd11XsdUrl))
    throw fail("CFDI_XSD_SCHEMA_INTEGRITY_FAILED");
  for (const url of tfd.xsd.imports)
    if (!schemas.has(url)) throw fail("CFDI_XSD_SCHEMA_INTEGRITY_FAILED");
  schemas.set(tfd11XsdUrl, {
    bytes: tfd.xsd.bytes,
    imports: tfd.xsd.imports,
    sha256: tfd.xsd.sha256,
  });
  const bytes = new Uint8Array(Buffer.from(wrapperText, "utf8"));
  const wrapper = Object.freeze({
    url: stampedXsdWrapperUrl,
    bytes,
    sha256: sha256(bytes),
  });
  const lines = [
    ...[...schemas].map(([url, schema]) => `${url} ${schema.sha256}`),
    `${wrapper.url} ${wrapper.sha256}`,
  ]
    .sort()
    .join("\n");
  return Object.freeze({ setSha256: sha256(lines), wrapper, schemas });
}

/** cfdv40.xsd and the TFD schema, and everything they import, transitively. */
function expectedLoads(set: StampedCfdi40XsdSet) {
  const expected = new Set<string>();
  const visit = (url: string) => {
    if (expected.has(url)) return;
    expected.add(url);
    for (const imported of set.schemas.get(url)?.imports ?? []) visit(imported);
  };
  visit(cfdi40XsdRootUrl);
  visit(tfd11XsdUrl);
  return expected;
}

type InspectingXsd = Cfdi40CompiledXsd &
  Required<Pick<Cfdi40CompiledXsd, "inspect">>;
const compiled = new WeakMap<
  Cfdi40XsdEngine,
  Map<string, { set: StampedCfdi40XsdSet; xsd: InspectingXsd }>
>();

/**
 * The stamped-CFDI set compiled by an engine, once per engine and set. The engine must offer
 * `inspect` (validation and element tree from one parse). Fails closed with
 * CFDI_XSD_SCHEMA_INTEGRITY_FAILED when compiling asks for anything but the expected schemas.
 */
export function compileStampedCfdi40Xsd(
  engine: Cfdi40XsdEngine,
  set: StampedCfdi40XsdSet,
): InspectingXsd {
  let bySet = compiled.get(engine);
  if (!bySet) compiled.set(engine, (bySet = new Map()));
  const cached = bySet.get(set.setSha256);
  if (cached && cached.set === set) return cached.xsd;
  const requested = new Set<string>();
  let refused = false;
  let xsd: Cfdi40CompiledXsd;
  try {
    xsd = engine.compile(
      { url: set.wrapper.url, bytes: set.wrapper.bytes },
      (url) => {
        const bytes = isOfficialSatXsdLocation(url)
          ? (set.schemas.get(url)?.bytes ?? null)
          : null;
        if (bytes) requested.add(url);
        else refused = true;
        return bytes;
      },
    );
  } catch (error) {
    if (error instanceof Cfdi40Error) throw error;
    throw fail("CFDI_XSD_SCHEMA_UNAVAILABLE");
  }
  const expected = expectedLoads(set);
  if (
    refused ||
    requested.size !== expected.size ||
    [...expected].some((url) => !requested.has(url))
  )
    throw fail("CFDI_XSD_SCHEMA_INTEGRITY_FAILED");
  if (typeof xsd.inspect !== "function")
    throw fail("CFDI_XSD_SCHEMA_UNAVAILABLE");
  const inspecting = xsd as InspectingXsd;
  bySet.set(set.setSha256, { set, xsd: inspecting });
  return inspecting;
}
