// Versions the official CFDI 4.0 technical resources (Fase 5C.4, 5C.5, 5C.7).
// To obtain the files, use scripts/sat/fetch-cfdi40-resources.mjs (allowlisted SAT URLs into
// an empty staging directory, with a diff against this manifest); review, then run this.
//
// Inputs (never fetched at request time):
//   --dir          directory with the files downloaded from the official SAT URLs below,
//                  with their HTTP response headers saved as <file>.headers (curl -D);
//                  every xsl:include/xsl:import of cadenaoriginal_4_0.xslt (transitively)
//                  under <dir>/xslt/<path after http://www.sat.gob.mx/sitio_internet/cfd/>
//   --obtained-at  YYYY-MM-DD date of that download
//   --replace      (optional) allow replacing a stored resource whose bytes differ
//
// Stored resources are copied byte-for-byte into resources/sat/cfdi40/ (".gitattributes":
// resources/sat/** binary, so Git never converts their CRLF line endings); the XSLT includes
// keep their official path under resources/sat/cfdi40/xslt/. Reference documents are only
// hashed. Outputs: src/lib/sat/cfdi40/manifest.json and cadenaoriginal-xslt.json (the exact
// text of the cadena original XSLT and its includes, bundled with the server code so no
// runtime file read or download is needed; checked against the manifest hashes).
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  buildCfdi40XsdBundle,
  writeCfdi40XsdBundle,
} from "./cfdi40-xsd-bundle.mjs";

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
if (typeof args.dir !== "string") throw new Error("Missing --dir");
if (!/^\d{4}-\d{2}-\d{2}$/.test(args["obtained-at"] ?? ""))
  throw new Error("--obtained-at must be YYYY-MM-DD");

const listedOn =
  "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm";
const documents =
  "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/";
const resources = [
  {
    name: "cfdv40.xsd",
    url: "http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd",
    kind: "XSD",
    version: "4.0",
    purpose:
      "Esquema del CFDI 4.0: estructura, orden, tipos y restricciones del Comprobante.",
    store: true,
  },
  {
    name: "tdCFDI.xsd",
    url: "http://www.sat.gob.mx/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd",
    kind: "XSD",
    version: null,
    purpose:
      "Tipos de datos comunes importados por cfdv40.xsd (t_RFC, t_Importe, t_FechaH).",
    store: true,
  },
  {
    name: "catCFDI.xsd",
    url: "http://www.sat.gob.mx/sitio_internet/cfd/catalogos/catCFDI.xsd",
    kind: "XSD",
    version: null,
    purpose:
      "Catálogos importados por cfdv40.xsd. Versionado desde Fase 5C (src/lib/sat/catcfdi/manifest.json).",
    store: true,
  },
  {
    name: "cadenaoriginal_4_0.xslt",
    url: "http://www.sat.gob.mx/sitio_internet/cfd/4/cadenaoriginal_4_0/cadenaoriginal_4_0.xslt",
    kind: "XSLT",
    version: "4.0",
    purpose:
      "Secuencia oficial de la cadena original del CFDI 4.0. Versionada sin ejecutar: no hay motor XSLT aprobado y sus xsl:include remotos no están versionados todavía.",
    store: true,
  },
  {
    name: "MatrizDeErrores_CFDI_v40_20260325.xls",
    url: documents + "MatrizDeErrores_CFDI_v40_20260325.xls",
    kind: "ERROR_MATRIX",
    version: "v40_20260325",
    purpose:
      "Matriz oficial de errores de validación del CFDI 4.0 (códigos CFDI40xxx citados por las validaciones).",
    store: true,
  },
  {
    name: "Anexo_20_Guia_de_llenado_CFDI.pdf",
    url: documents + "Anexo_20_Guia_de_llenado_CFDI.pdf",
    kind: "REFERENCE",
    version: "publicada 16/01/2026",
    purpose:
      "Guía de llenado del CFDI 4.0: redondeo al final del cálculo y uso de decimales.",
    store: false,
  },
  {
    name: "Anexo20_2022.pdf",
    url: documents + "Anexo20_2022.pdf",
    kind: "REFERENCE",
    version: "DOF 13/01/2022",
    purpose:
      "Estándar técnico del Anexo 20: fórmulas de límite inferior y superior de Importe.",
    store: false,
  },
];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const header = (file, name) =>
  readFileSync(file + ".headers", "latin1")
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().startsWith(name.toLowerCase() + ":"))
    ?.slice(name.length + 1)
    .trim() ?? null;
const target = path.resolve("resources/sat/cfdi40");
mkdirSync(target, { recursive: true });

/** Copies an official file byte-for-byte; a different stored copy needs --replace. */
function store(source, name, digest) {
  const destination = path.join(target, ...name.split("/"));
  if (existsSync(destination) && sha256(readFileSync(destination)) !== digest) {
    if (args.replace !== true)
      throw new Error(
        name + " differs from the stored copy; review and pass --replace",
      );
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  return "resources/sat/cfdi40/" + name;
}
const xslReferences = (text) =>
  [...text.matchAll(/<xsl:(?:include|import)\s+href="([^"]+)"/g)].map(
    (m) => m[1],
  );

const entries = resources.map((resource) => {
  const source = path.join(args.dir, resource.name);
  const bytes = readFileSync(source);
  const digest = sha256(bytes);
  let stored = false;
  if (resource.store) stored = store(source, resource.name, digest);
  const entry = {
    name: resource.name,
    kind: resource.kind,
    version: resource.version,
    purpose: resource.purpose,
    url: resource.url,
    listedOn,
    obtainedAt: args["obtained-at"],
    lastModified: header(source, "Last-Modified"),
    etag: header(source, "ETag"),
    bytes: bytes.length,
    sha256: digest,
    stored,
  };
  if (resource.kind === "XSLT") {
    const text = bytes.toString("utf8");
    entry.xsltVersion =
      /<xsl:stylesheet\b[^>]*\bversion="([^"]+)"/.exec(text)?.[1] ?? null;
    entry.includes = xslReferences(text);
    entry.includesStored = true;
    entry.executed = false;
  }
  if (resource.kind === "XSD") {
    const text = bytes.toString("utf8");
    entry.imports = [
      ...text.matchAll(/<xs:import\b[^>]*schemaLocation="([^"]+)"/g),
    ].map((m) => m[1]);
  }
  return entry;
});

// Every xsl:include/xsl:import, transitively. Only official SAT URLs are accepted and each
// one is stored under resources/sat/cfdi40/xslt/<official path>.
const satCfd = "http://www.sat.gob.mx/sitio_internet/cfd/";
const root = entries.find((e) => e.kind === "XSLT");
const includeEntries = [];
function versionIncludes(parent, hrefs) {
  for (const href of hrefs) {
    const relative = href.startsWith(satCfd) ? href.slice(satCfd.length) : "";
    if (
      !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\.xslt$/.test(relative) ||
      relative.split("/").includes("..")
    )
      throw new Error(parent + ": include outside " + satCfd + ": " + href);
    if (includeEntries.some((e) => e.url === href)) continue;
    const name = "xslt/" + relative;
    const source = path.join(args.dir, "xslt", ...relative.split("/"));
    const bytes = readFileSync(source);
    const digest = sha256(bytes);
    const text = bytes.toString("utf8");
    const nested = xslReferences(text);
    includeEntries.push({
      name,
      kind: "XSLT_INCLUDE",
      version: null,
      purpose:
        "Plantilla oficial incluida por la cadena original del CFDI 4.0 (" +
        relative +
        "). Versionada sin modificar.",
      url: href,
      listedOn: root.url,
      referencedBy: parent,
      obtainedAt: args["obtained-at"],
      lastModified: header(source, "Last-Modified"),
      etag: header(source, "ETag"),
      bytes: bytes.length,
      sha256: digest,
      stored: store(source, name, digest),
      xsltVersion:
        /<xsl:stylesheet\b[^>]*\bversion="([^"]+)"/.exec(text)?.[1] ?? null,
      includes: nested,
    });
    versionIncludes(name, nested);
  }
}
versionIncludes(root.name, root.includes);

// The cadena original XSLT set as exact UTF-8 text, for the server bundle.
const bundle = [root, ...includeEntries].map((entry) => {
  const bytes = readFileSync(path.resolve(entry.stored));
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes))
    throw new Error(entry.name + " is not valid UTF-8; it cannot be bundled");
  return { url: entry.url, name: entry.name, sha256: entry.sha256, text };
});

const output = path.resolve("src/lib/sat/cfdi40");
mkdirSync(output, { recursive: true });
const manifest = {
  standard: "CFDI",
  cfdiVersion: "4.0",
  namespace: "http://www.sat.gob.mx/cfd/4",
  schemaLocation: "http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd",
  resources: [...entries, ...includeEntries],
};
// Fase 5C.7: XSD namespaces, import graph (closed) and the runtime XSD bundle.
const xsdBundle = buildCfdi40XsdBundle(manifest);
writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
writeCfdi40XsdBundle(xsdBundle, output);
writeFileSync(
  path.join(output, "cadenaoriginal-xslt.json"),
  JSON.stringify({ root: root.url, resources: bundle }, null, 2) + "\n",
);
for (const e of [...entries, ...includeEntries])
  console.log(e.name, e.bytes, e.sha256.slice(0, 12), e.stored || "hash only");
