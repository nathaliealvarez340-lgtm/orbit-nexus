// Builds the versioned, server-side SAT catalog resources (Fase 5C D3/D5).
//
// Inputs (never fetched at request time):
//   --xls  official catCFDI_V_4_*.xls (only hashed; it is not stored in the repository)
//   --tsv  directory with sheets exported by scripts/sat/export-catcfdi.ps1
//   --xsd  official catCFDI.xsd, stored at resources/sat/cfdi40/catCFDI.xsd
//   --obtained-at YYYY-MM-DD  date the official files were downloaded
//
// Output: src/lib/sat/catcfdi/*.json and manifest.json with origin, version and SHA-256.
// A catalog is marked complete only when every code read from the official xls is
// also an enumeration of the official XSD.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);
for (const required of ["xls", "tsv", "xsd", "obtained-at"])
  if (!args[required]) throw new Error("Missing --" + required);
if (!/^\d{4}-\d{2}-\d{2}$/.test(args["obtained-at"]))
  throw new Error("--obtained-at must be YYYY-MM-DD");

const release = path.basename(args.xls).replace(/\.xls$/i, "");
const outDir = path.resolve("src/lib/sat/catcfdi");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const sheet = (name) => {
  const file = path.join(args.tsv, name + ".tsv");
  const text = readFileSync(file, "utf8");
  return {
    rows: text.split("\n").map((line) => line.split("\t")),
    sha256: sha256(text),
  };
};
// Excel 1900 date system serial → ISO date (serial 44562 = 2022-01-01).
const isoDate = (serial) => {
  // The official sheets use 0 or blank when a date is not published.
  if (!serial || !/^\d+(\.\d+)?$/.test(serial) || Number(serial) <= 0)
    return null;
  const date = new Date(
    Date.UTC(1899, 11, 30) + Math.floor(Number(serial)) * 86400000,
  );
  return date.toISOString().slice(0, 10);
};
const yes = (value) => {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "sí" || v === "si") return true;
  if (v === "no") return false;
  throw new Error("Unexpected Sí/No value: " + value);
};
const personTypes = (fisica, moral) =>
  [yes(fisica) && "INDIVIDUAL", yes(moral) && "COMPANY"].filter(Boolean);
// Catalog metadata row: Versión CFDI | Versión catálogo | Revisión | Publicación | Inicio | Fin
const metadata = (rows) => {
  const row = rows.find((r) => r[0] === "4");
  if (!row) throw new Error("Catalog metadata row not found");
  return {
    catalogVersion: row[1],
    catalogRevision: row[2],
    publishedOn: isoDate(row[3]),
    validFrom: isoDate(row[4]),
    validTo: isoDate(row[5]),
  };
};

const xsdBytes = readFileSync(args.xsd);
const xsd = xsdBytes.toString("utf8");
function xsdEnumeration(name) {
  const start = xsd.indexOf(`<xs:simpleType name="${name}">`);
  if (start < 0) throw new Error("XSD type not found: " + name);
  const end = xsd.indexOf("</xs:simpleType>", start);
  return new Set(
    [...xsd.slice(start, end).matchAll(/<xs:enumeration value="([^"]*)"/g)].map(
      (m) => m[1],
    ),
  );
}
function verify(name, codes) {
  const official = xsdEnumeration(name);
  const missing = codes.filter((code) => !official.has(code));
  const set = new Set(codes);
  if (set.size !== codes.length)
    throw new Error(name + " has duplicated codes");
  return {
    complete: missing.length === 0 && codes.length > 0,
    verification: {
      method: "every xls code is an enumeration of the official catCFDI.xsd",
      xlsCodes: codes.length,
      xsdCodes: official.size,
      codesMissingFromXsd: missing,
      xsdOnlyCodes: [...official].filter((code) => !set.has(code)).sort(),
    },
  };
}

// c_RegimenFiscal
const regimeSheet = sheet("c_RegimenFiscal");
const regimes = regimeSheet.rows
  .filter((r) => /^\d{3}$/.test(r[0]))
  .map((r) => ({
    code: r[0],
    description: r[1].trim(),
    personTypes: personTypes(r[2], r[3]),
    validFrom: isoDate(r[4]),
    validTo: isoDate(r[5]),
  }));

// c_UsoCFDI
const useSheet = sheet("c_UsoCFDI");
const uses = useSheet.rows
  .filter((r) => /^[A-Z]{1,2}\d{2}$/.test(r[0]))
  .map((r) => ({
    code: r[0],
    description: r[1].trim(),
    personTypes: personTypes(r[2], r[3]),
    validFrom: isoDate(r[4]),
    validTo: isoDate(r[5]),
    receiverRegimes: r[6]
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean),
  }));
const regimeCodes = new Set(regimes.map((r) => r.code));
for (const use of uses)
  for (const regime of use.receiverRegimes)
    if (!regimeCodes.has(regime))
      throw new Error(`${use.code} references unknown regime ${regime}`);

// c_CodigoPostal (split in two official sheets). Time-zone references are kept as
// published (description, DST start/end and offsets); they are not interpreted here.
const postalSheets = [
  sheet("c_CodigoPostal_Parte_1"),
  sheet("c_CodigoPostal_Parte_2"),
];
const timeZones = [];
const timeZoneIndex = new Map();
const postalEntries = [];
for (const { rows } of postalSheets)
  for (const r of rows) {
    if (!/^\d{1,5}$/.test(r[0]) || !/^[A-Z]{3}$/.test(r[1] ?? "")) continue;
    const zone = {
      description: r[7].trim(),
      summer: {
        month: r[8].trim(),
        day: r[9].trim(),
        time: r[10].trim(),
        utcOffset: r[11].trim(),
      },
      winter: {
        month: r[12].trim(),
        day: r[13].trim(),
        time: r[14].trim(),
        utcOffset: r[15].trim(),
      },
    };
    const key = JSON.stringify(zone);
    if (!timeZoneIndex.has(key)) {
      timeZoneIndex.set(key, timeZones.length);
      timeZones.push(zone);
    }
    postalEntries.push(
      [
        r[0].padStart(5, "0"),
        r[1],
        r[2].trim() ? r[2].trim().padStart(3, "0") : "",
        r[3].trim() ? r[3].trim().padStart(2, "0") : "",
        r[4].trim() === "1" ? "1" : "0",
        isoDate(r[5]) ?? "",
        isoDate(r[6]) ?? "",
        String(timeZoneIndex.get(key)),
      ].join("|"),
    );
  }
postalEntries.sort();

mkdirSync(outDir, { recursive: true });
const outputs = {
  c_RegimenFiscal: {
    data: { ...metadata(regimeSheet.rows), entries: regimes },
    verify: verify(
      "c_RegimenFiscal",
      regimes.map((r) => r.code),
    ),
  },
  c_UsoCFDI: {
    data: { ...metadata(useSheet.rows), entries: uses },
    verify: verify(
      "c_UsoCFDI",
      uses.map((u) => u.code),
    ),
  },
  c_CodigoPostal: {
    data: {
      ...metadata(postalSheets[0].rows),
      format:
        "codigoPostal|c_Estado|c_Municipio|c_Localidad|estimuloFranjaFronteriza|validFrom|validTo|timeZoneIndex",
      timeZones,
      entries: postalEntries,
    },
    verify: verify(
      "c_CodigoPostal",
      postalEntries.map((e) => e.slice(0, 5)),
    ),
  },
};
const catalogs = {};
for (const [name, { data, verify: check }] of Object.entries(outputs)) {
  const text =
    JSON.stringify(data, null, name === "c_CodigoPostal" ? 0 : 2) + "\n";
  const file = name + ".json";
  writeFileSync(path.join(outDir, file), text);
  catalogs[name] = {
    file,
    sha256: sha256(text),
    entries: data.entries.length,
    catalogVersion: data.catalogVersion,
    catalogRevision: data.catalogRevision,
    publishedOn: data.publishedOn,
    ...check,
  };
}
const manifest = {
  catalog: "catCFDI",
  cfdiVersion: "4.0",
  release,
  sources: [
    {
      name: path.basename(args.xls),
      url:
        "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/" +
        path.basename(args.xls),
      listedOn:
        "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm",
      obtainedAt: args["obtained-at"],
      bytes: statSync(args.xls).size,
      sha256: sha256(readFileSync(args.xls)),
      stored: false,
    },
    {
      name: "catCFDI.xsd",
      url: "http://www.sat.gob.mx/sitio_internet/cfd/catalogos/catCFDI.xsd",
      listedOn:
        "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm",
      obtainedAt: args["obtained-at"],
      bytes: xsdBytes.length,
      sha256: sha256(xsdBytes),
      stored: "resources/sat/cfdi40/catCFDI.xsd",
    },
  ],
  extraction: {
    method:
      "Microsoft Excel COM, read-only, macros force-disabled; UsedRange.Value2 exported to UTF-8 TSV",
    script: "scripts/sat/export-catcfdi.ps1",
    sheets: Object.fromEntries(
      [
        "c_RegimenFiscal",
        "c_UsoCFDI",
        "c_CodigoPostal_Parte_1",
        "c_CodigoPostal_Parte_2",
      ].map((name) => [
        name,
        sha256(readFileSync(path.join(args.tsv, name + ".tsv"), "utf8")),
      ]),
    ),
  },
  catalogs,
};
writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
for (const [name, entry] of Object.entries(catalogs))
  console.log(
    name,
    entry.entries,
    "complete=" + entry.complete,
    "xsdOnly=" + entry.verification.xsdOnlyCodes.length,
  );
