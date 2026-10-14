// Fase 5C.8: the official Timbre Fiscal Digital 1.1 resources (TimbreFiscalDigitalv11.xsd and
// cadenaoriginal_TFD_1_1.xslt) for validating a PAC response.
//
//   node scripts/sat/tfd11-bundle.mjs --add <reviewed dir> --obtained-at YYYY-MM-DD [--replace]
//   node scripts/sat/tfd11-bundle.mjs            (refresh the bundle from what is stored)
//
// --add versions the two files of a REVIEWED download (scripts/sat/fetch-cfdi40-resources.mjs
// layout: <dir>/<name> and <dir>/<name>.headers) byte-for-byte into resources/sat/cfdi40/ and
// upserts their manifest entries (kinds TFD_XSD and TFD_XSLT). A stored copy with other bytes
// needs --replace (SAT update gate: review the diff first). Both modes check that the XSD
// imports only versioned CFDI 4.0 schemas, that the XSLT includes nothing, and write
// src/lib/sat/cfdi40/tfd11.json: the exact UTF-8 texts, bundled with the server code so the
// runtime never reads files or downloads anything. Idempotent.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { targetNamespace, xsdReferences } from "./cfdi40-xsd-bundle.mjs";

const tfdBase = "http://www.sat.gob.mx/sitio_internet/cfd/TimbreFiscalDigital/";
export const tfd11Resources = [
  {
    name: "TimbreFiscalDigitalv11.xsd",
    kind: "TFD_XSD",
    version: "1.1",
    purpose:
      "Esquema del complemento Timbre Fiscal Digital 1.1: valida el TFD que devuelve el PAC y el CFDI timbrado (con cfdv40.xsd).",
    url: tfdBase + "TimbreFiscalDigitalv11.xsd",
  },
  {
    name: "cadenaoriginal_TFD_1_1.xslt",
    kind: "TFD_XSLT",
    version: "1.1",
    purpose:
      "Secuencia oficial de la cadena original del Timbre Fiscal Digital 1.1 (la que firma el SelloSAT).",
    url: tfdBase + "cadenaoriginal_TFD_1_1.xslt",
  },
];
const listedOn =
  "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm";
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const header = (file, name) =>
  readFileSync(file + ".headers", "latin1")
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith(name.toLowerCase() + ":"))
    ?.slice(name.length + 1)
    .trim() || null;

/** Versions the reviewed files and upserts their manifest entries (in place). */
export function addTfd11Resources(manifest, options, root = process.cwd()) {
  const target = path.resolve(root, "resources/sat/cfdi40");
  mkdirSync(target, { recursive: true });
  for (const resource of tfd11Resources) {
    const source = path.join(options.dir, resource.name);
    const bytes = readFileSync(source);
    const digest = sha256(bytes);
    const destination = path.join(target, resource.name);
    if (
      existsSync(destination) &&
      sha256(readFileSync(destination)) !== digest &&
      options.replace !== true
    )
      throw new Error(
        resource.name +
          " differs from the stored copy; review and pass --replace",
      );
    copyFileSync(source, destination);
    const entry = {
      name: resource.name,
      kind: resource.kind,
      version: resource.version,
      purpose: resource.purpose,
      url: resource.url,
      listedOn,
      obtainedAt: options.obtainedAt,
      lastModified: header(source, "Last-Modified"),
      etag: header(source, "ETag"),
      bytes: bytes.length,
      sha256: digest,
      stored: "resources/sat/cfdi40/" + resource.name,
    };
    const index = manifest.resources.findIndex((r) => r.url === resource.url);
    if (index === -1) manifest.resources.push(entry);
    else manifest.resources[index] = { ...manifest.resources[index], ...entry };
  }
}

/**
 * Checks the stored TFD resources against the manifest, adds `namespace`/`imports` (XSD)
 * and `xsltVersion`/`includes` (XSLT) to their entries (in place) and returns the bundle.
 */
export function buildTfd11Bundle(manifest, root = process.cwd()) {
  const texts = {};
  for (const resource of tfd11Resources) {
    const entry = manifest.resources.find(
      (r) => r.url === resource.url && r.kind === resource.kind,
    );
    if (!entry || typeof entry.stored !== "string")
      throw new Error(resource.name + " is not versioned");
    const bytes = readFileSync(path.resolve(root, entry.stored));
    if (sha256(bytes) !== entry.sha256)
      throw new Error(resource.name + " differs from its manifest SHA-256");
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes))
      throw new Error(
        resource.name + " is not valid UTF-8; it cannot be bundled",
      );
    texts[resource.kind] = { entry, text };
  }
  const xsd = texts.TFD_XSD;
  const namespace = targetNamespace(xsd.text);
  if (namespace !== "http://www.sat.gob.mx/TimbreFiscalDigital")
    throw new Error("TimbreFiscalDigitalv11.xsd: unexpected targetNamespace");
  const versioned = new Set(
    manifest.resources.filter((r) => r.kind === "XSD").map((r) => r.url),
  );
  const references = xsdReferences(xsd.text);
  for (const { kind, url } of references) {
    if (kind !== "import")
      throw new Error(
        "TimbreFiscalDigitalv11.xsd: xs:" + kind + " is not supported",
      );
    if (!versioned.has(url))
      throw new Error(
        "TimbreFiscalDigitalv11.xsd imports an unversioned schema: " + url,
      );
  }
  xsd.entry.namespace = namespace;
  xsd.entry.imports = references.map((r) => r.url);
  const xslt = texts.TFD_XSLT;
  const includes = [
    ...xslt.text.matchAll(/<xsl:(?:include|import)\s+href="([^"]+)"/g),
  ].map((m) => m[1]);
  if (includes.length)
    throw new Error(
      "cadenaoriginal_TFD_1_1.xslt: unexpected xsl:include/import",
    );
  xslt.entry.xsltVersion =
    /<xsl:stylesheet\b[^>]*\bversion="([^"]+)"/.exec(xslt.text)?.[1] ?? null;
  xslt.entry.includes = [];
  const item = ({ entry, text }) => ({
    url: entry.url,
    name: entry.name,
    sha256: entry.sha256,
    text,
  });
  return {
    xsd: { ...item(xsd), namespace, imports: xsd.entry.imports },
    xslt: item(xslt),
  };
}

export function writeTfd11Bundle(bundle, output) {
  writeFileSync(
    path.join(output, "tfd11.json"),
    JSON.stringify(bundle, null, 2) + "\n",
  );
}

// CLI.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, all) => {
      if (value.startsWith("--"))
        pairs.push([
          value.slice(2),
          all[index + 1]?.startsWith("--") ? true : (all[index + 1] ?? true),
        ]);
      return pairs;
    }, []),
  );
  const output = path.resolve("src/lib/sat/cfdi40");
  const manifestPath = path.join(output, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (args.add !== undefined) {
    if (typeof args.add !== "string") throw new Error("Missing --add <dir>");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args["obtained-at"] ?? ""))
      throw new Error("--obtained-at must be YYYY-MM-DD");
    addTfd11Resources(manifest, {
      dir: args.add,
      obtainedAt: args["obtained-at"],
      replace: args.replace,
    });
  }
  const bundle = buildTfd11Bundle(manifest);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  writeTfd11Bundle(bundle, output);
  for (const item of [bundle.xsd, bundle.xslt])
    console.log(item.name, item.sha256.slice(0, 12));
}
