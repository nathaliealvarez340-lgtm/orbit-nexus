// Versions the official CFDI 4.0 technical resources (Fase 5C.4).
//
// Inputs (never fetched at request time):
//   --dir          directory with the files downloaded from the official SAT URLs below,
//                  with their HTTP response headers saved as <file>.headers (curl -D)
//   --obtained-at  YYYY-MM-DD date of that download
//   --replace      (optional) allow replacing a stored resource whose bytes differ
//
// Stored resources are copied byte-for-byte into resources/sat/cfdi40/ (".gitattributes":
// resources/sat/** binary, so Git never converts their CRLF line endings). Reference
// documents are only hashed. Output: src/lib/sat/cfdi40/manifest.json.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

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

const entries = resources.map((resource) => {
  const source = path.join(args.dir, resource.name);
  const bytes = readFileSync(source);
  const digest = sha256(bytes);
  let stored = false;
  if (resource.store) {
    const destination = path.join(target, resource.name);
    if (
      existsSync(destination) &&
      sha256(readFileSync(destination)) !== digest
    ) {
      if (args.replace !== true)
        throw new Error(
          resource.name +
            " differs from the stored copy; review and pass --replace",
        );
    }
    copyFileSync(source, destination);
    stored = "resources/sat/cfdi40/" + resource.name;
  }
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
    entry.includes = [
      ...text.matchAll(/<xsl:(?:include|import)\s+href="([^"]+)"/g),
    ].map((m) => m[1]);
    entry.includesStored = false;
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

const output = path.resolve("src/lib/sat/cfdi40");
mkdirSync(output, { recursive: true });
writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      standard: "CFDI",
      cfdiVersion: "4.0",
      namespace: "http://www.sat.gob.mx/cfd/4",
      schemaLocation: "http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd",
      resources: entries,
    },
    null,
    2,
  ) + "\n",
);
for (const e of entries)
  console.log(e.name, e.bytes, e.sha256.slice(0, 12), e.stored || "hash only");
