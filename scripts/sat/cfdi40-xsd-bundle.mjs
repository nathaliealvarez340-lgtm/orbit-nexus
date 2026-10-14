// Fase 5C.7: the official CFDI 4.0 XSD set for the runtime validator.
//
// From the XSD entries of src/lib/sat/cfdi40/manifest.json and their byte-exact copies in
// resources/sat/cfdi40 (already versioned and hash-checked), this derives, for each schema,
// its targetNamespace and the schemas that import it, checks that the xs:import /
// xs:include / xs:redefine / xs:override graph is closed (every reference is a versioned
// official schema, and nothing versioned is unreferenced except the root), and writes
// src/lib/sat/cfdi40/cfdv40-xsd.json: the exact UTF-8 text of each schema, bundled with the
// server code so the validator never reads files or downloads anything at runtime.
//
// Used by build-cfdi40-resources.mjs after it versions the resources, and runnable alone
// (`node scripts/sat/cfdi40-xsd-bundle.mjs`) to refresh the bundle and the XSD manifest
// fields from what is stored. Idempotent; it never changes a stored schema.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const cfdi40XsdRoot =
  "http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd";
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Every schemaLocation of xs:import, xs:include, xs:redefine and xs:override, in order. */
export const xsdReferences = (text) =>
  [
    ...text.matchAll(
      /<xs:(import|include|redefine|override)\b[^>]*?\bschemaLocation="([^"]+)"/g,
    ),
  ].map((m) => ({ kind: m[1], url: m[2] }));
export const targetNamespace = (text) =>
  /<xs:schema\b[^>]*?\btargetNamespace="([^"]+)"/.exec(text)?.[1] ?? null;

/**
 * Adds `namespace`, `imports` and `referencedBy` to the XSD entries of the manifest (in
 * place) and returns the bundle source. Throws on any unversioned, unreferenced or
 * non-official reference.
 */
export function buildCfdi40XsdBundle(manifest, root = process.cwd()) {
  const xsd = manifest.resources.filter((r) => r.kind === "XSD");
  const byUrl = new Map(xsd.map((r) => [r.url, r]));
  if (!byUrl.has(cfdi40XsdRoot)) throw new Error("cfdv40.xsd is not versioned");
  const texts = new Map();
  for (const entry of xsd) {
    if (typeof entry.stored !== "string")
      throw new Error(entry.name + " is not stored");
    const bytes = readFileSync(path.resolve(root, entry.stored));
    if (sha256(bytes) !== entry.sha256)
      throw new Error(entry.name + " differs from its manifest SHA-256");
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes))
      throw new Error(entry.name + " is not valid UTF-8; it cannot be bundled");
    texts.set(entry.url, text);
  }
  for (const entry of xsd) entry.referencedBy = [];
  for (const entry of xsd) {
    const text = texts.get(entry.url);
    const namespace = targetNamespace(text);
    if (!namespace) throw new Error(entry.name + " has no targetNamespace");
    entry.namespace = namespace;
    const references = xsdReferences(text);
    for (const { kind, url } of references) {
      if (kind !== "import")
        throw new Error(entry.name + ": xs:" + kind + " is not supported yet");
      const target = byUrl.get(url);
      if (!target)
        throw new Error(entry.name + " imports an unversioned schema: " + url);
      target.referencedBy.push(entry.url);
    }
    entry.imports = references.map((r) => r.url);
  }
  for (const entry of xsd)
    if (entry.url !== cfdi40XsdRoot && entry.referencedBy.length === 0)
      throw new Error(entry.name + " is versioned but nothing imports it");
  return {
    root: cfdi40XsdRoot,
    resources: xsd.map((entry) => ({
      url: entry.url,
      name: entry.name,
      namespace: entry.namespace,
      imports: entry.imports,
      sha256: entry.sha256,
      text: texts.get(entry.url),
    })),
  };
}

export function writeCfdi40XsdBundle(bundle, output) {
  writeFileSync(
    path.join(output, "cfdv40-xsd.json"),
    JSON.stringify(bundle, null, 2) + "\n",
  );
}

// CLI: refresh from the stored resources.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const output = path.resolve("src/lib/sat/cfdi40");
  const manifestPath = path.join(output, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bundle = buildCfdi40XsdBundle(manifest);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  writeCfdi40XsdBundle(bundle, output);
  for (const r of bundle.resources)
    console.log(
      r.name,
      r.namespace,
      "imports",
      r.imports.length,
      r.sha256.slice(0, 12),
    );
}
