// Builds the versioned, server-side SAT catalog resources (Fase 5C D3/D5).
//
// Inputs (never fetched at request time):
//   --xls  official catCFDI_V_4_*.xls (only hashed; it is not stored in the repository)
//   --tsv  directory with sheets exported by scripts/sat/export-catcfdi.ps1
//   --xsd  official catCFDI.xsd, stored at resources/sat/cfdi40/catCFDI.xsd
//   --obtained-at YYYY-MM-DD  date the official files were downloaded
//   --reverified-at YYYY-MM-DD  (optional) date the same release was downloaded again and
//                               found byte-identical (same SHA-256)
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
for (const key of ["obtained-at", "reverified-at"])
  if (args[key] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args[key]))
    throw new Error("--" + key + " must be YYYY-MM-DD");
const reverified = args["reverified-at"]
  ? { reverifiedAt: args["reverified-at"] }
  : {};

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

// Fase 5C.4: catalogs needed to build CFDI 4.0 Ingreso. Each sheet is read by the labels of
// its header row (the row whose first cell names the catalog), never by fixed positions.
const table = (name, codeHeader = name) => {
  const { rows } = sheet(name);
  const headerIndex = rows.findIndex((r) => r[0].trim() === codeHeader);
  if (headerIndex < 0) throw new Error(name + ": header row not found");
  const header = rows[headerIndex].map((h) => h.replace(/\s+/g, " ").trim());
  const column = (...labels) => {
    const index = header.findIndex((h) => labels.includes(h));
    if (index < 0) throw new Error(`${name}: column "${labels[0]}" not found`);
    return index;
  };
  return { rows: rows.slice(headerIndex + 1), column, meta: metadata(rows) };
};
const validity = (t) => {
  const from = t.column(
    "Fecha inicio de vigencia",
    "Fecha de inicio de vigencia",
    "FechaInicioVigencia",
  );
  const to = t.column(
    "Fecha fin de vigencia",
    "Fecha de fin de vigencia",
    "FechaFinVigencia",
  );
  return (r) => ({ validFrom: isoDate(r[from]), validTo: isoDate(r[to]) });
};
// Excel exports numeric codes without their leading zeros ("1" for "01").
const code = (value, width) => {
  const v = value.trim();
  return width && /^\d+$/.test(v) ? v.padStart(width, "0") : v;
};
const rows = (t, pattern) => t.rows.filter((r) => pattern.test(r[0].trim()));
const text = (value) => value.replace(/\s+/g, " ").trim();
// Published rates ("0.16", "72.1605") as fixed 6-decimal strings, without floating point.
const rate6 = (value) => {
  const v = value.trim();
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(v);
  if (!match) throw new Error("Unexpected rate: " + value);
  return match[1] + "." + (match[2] ?? "").padEnd(6, "0");
};

const paymentFormTable = table("c_FormaPago");
const paymentForms = (() => {
  const t = paymentFormTable,
    description = t.column("Descripción"),
    banked = t.column("Bancarizado"),
    when = validity(t);
  return rows(t, /^\d{1,2}$/).map((r) => ({
    code: code(r[0], 2),
    description: text(r[description]),
    banked: text(r[banked]),
    ...when(r),
  }));
})();

const simpleCatalog = (t, pattern, width) => {
  const description = t.column("Descripción"),
    when = validity(t);
  return rows(t, pattern).map((r) => ({
    code: code(r[0], width),
    description: text(r[description]),
    ...when(r),
  }));
};
const paymentMethodTable = table("c_MetodoPago");
const paymentMethods = simpleCatalog(paymentMethodTable, /^[A-Z]{3}$/);
const exportTable = table("c_Exportacion");
const exports = simpleCatalog(exportTable, /^\d{1,2}$/, 2);
const taxObjectTable = table("c_ObjetoImp");
const taxObjects = simpleCatalog(taxObjectTable, /^\d{1,2}$/, 2);

const documentTypeTable = table("c_TipoDeComprobante");
const documentTypes = (() => {
  const t = documentTypeTable,
    description = t.column("Descripción"),
    max = t.column("Valor máximo"),
    when = validity(t);
  return rows(t, /^[A-Z]$/).map((r) => ({
    code: r[0].trim(),
    description: text(r[description]),
    maxValue: /^\d+(\.\d+)?$/.test(r[max].trim()) ? r[max].trim() : null,
    ...when(r),
  }));
})();

const currencyTable = table("c_Moneda");
const currencies = (() => {
  const t = currencyTable,
    description = t.column("Descripción"),
    decimals = t.column("Decimales"),
    variation = t.column("Porcentaje variación"),
    when = validity(t);
  return rows(t, /^[A-Z]{3}$/).map((r) => {
    if (!/^\d$/.test(r[decimals].trim()))
      throw new Error("Unexpected decimals for " + r[0]);
    return {
      code: r[0].trim(),
      description: text(r[description]),
      decimals: Number(r[decimals].trim()),
      variationPercent: r[variation].trim() || null,
      ...when(r),
    };
  });
})();

const taxTable = table("c_Impuesto");
const taxes = (() => {
  const t = taxTable,
    description = t.column("Descripción"),
    withholding = t.column("Retención"),
    transfer = t.column("Traslado"),
    scope = t.column("Local o federal"),
    when = validity(t);
  return rows(t, /^\d{1,3}$/).map((r) => ({
    code: code(r[0], 3),
    description: text(r[description]),
    withholding: yes(r[withholding]),
    transfer: yes(r[transfer]),
    scope: text(r[scope]),
    ...when(r),
  }));
})();

const factorTable = table("c_TipoFactor");
const factors = (() => {
  const when = validity(factorTable);
  return rows(factorTable, /^(Tasa|Cuota|Exento)$/).map((r) => ({
    code: r[0].trim(),
    ...when(r),
  }));
})();

// c_TasaOCuota has no XSD enumeration. Its "Impuesto" column holds descriptions; each is
// resolved to a c_Impuesto code by exact match or "<description> " prefix (e.g. "IVA
// Crédito aplicado del 50%" → 002), keeping the published label.
const rateTable = table("c_TasaOCuota", "Rango o Fijo");
const rates = (() => {
  const t = rateTable,
    tax = t.column("Impuesto"),
    factor = t.column("Factor"),
    transfer = t.column("Traslado"),
    withholding = t.column("Retención"),
    when = validity(t);
  const [subHeader, ...data] = t.rows;
  if (
    subHeader[1].trim() !== "Valor mínimo" ||
    subHeader[2].trim() !== "Valor máximo"
  )
    throw new Error("c_TasaOCuota: unexpected value columns");
  return data
    .filter((r) => /^(Fijo|Rango)$/.test(r[0].trim()))
    .map((r) => {
      const label = text(r[tax]);
      const resolved = taxes.find(
        (x) => label === x.description || label.startsWith(x.description + " "),
      );
      if (!resolved) throw new Error("c_TasaOCuota: unknown tax " + label);
      if (!factors.some((f) => f.code === r[factor].trim()))
        throw new Error("c_TasaOCuota: unknown factor " + r[factor]);
      const fixed = r[0].trim() === "Fijo";
      return {
        kind: fixed ? "FIXED" : "RANGE",
        tax: resolved.code,
        taxLabel: label,
        factor: r[factor].trim(),
        min: fixed ? rate6(r[2]) : rate6(r[1]),
        max: rate6(r[2]),
        transfer: yes(r[transfer]),
        withholding: yes(r[withholding]),
        ...when(r),
      };
    });
})();

const unitTable = table("c_ClaveUnidad");
const units = (() => {
  const t = unitTable,
    name = t.column("Nombre"),
    symbol = t.column("Símbolo"),
    when = validity(t);
  return rows(t, /^[A-Z0-9]{1,3}$/)
    .map((r) => {
      const w = when(r);
      if (text(r[symbol]).includes("|") || text(r[name]).includes("|"))
        throw new Error("Unexpected | in c_ClaveUnidad " + r[0]);
      return [
        r[0].trim(),
        w.validFrom ?? "",
        w.validTo ?? "",
        text(r[symbol]),
        text(r[name]),
      ].join("|");
    })
    .sort();
})();

// Compact rows: code|includeVat|includeIeps|complement|validFrom|validTo|borderStimulus
// (S = Sí, O = Opcional, N = No). Descriptions are not needed to build or validate a CFDI.
const productTable = table("c_ClaveProdServ");
const products = (() => {
  const t = productTable,
    vat = t.column("Incluir IVA trasladado"),
    ieps = t.column("Incluir IEPS trasladado"),
    complement = t.column("Complemento que debe incluir"),
    stimulus = t.column("Estímulo Franja Fronteriza"),
    when = validity(t);
  const flag = (value) => {
    const v = text(value).toLowerCase();
    if (v === "sí" || v === "si") return "S";
    if (v === "opcional") return "O";
    if (v === "no") return "N";
    throw new Error("Unexpected c_ClaveProdServ flag: " + value);
  };
  return rows(t, /^\d{8}$/)
    .map((r) => {
      const w = when(r);
      const extra = text(r[complement]);
      if (extra.includes("|")) throw new Error("Unexpected | in complement");
      return [
        r[0].trim(),
        flag(r[vat]),
        flag(r[ieps]),
        extra,
        w.validFrom ?? "",
        w.validTo ?? "",
        text(r[stimulus]) === "1" ? "1" : "0",
      ].join("|");
    })
    .sort();
})();

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
  c_FormaPago: {
    data: { ...paymentFormTable.meta, entries: paymentForms },
    verify: verify(
      "c_FormaPago",
      paymentForms.map((e) => e.code),
    ),
  },
  c_MetodoPago: {
    data: { ...paymentMethodTable.meta, entries: paymentMethods },
    verify: verify(
      "c_MetodoPago",
      paymentMethods.map((e) => e.code),
    ),
  },
  c_Moneda: {
    data: { ...currencyTable.meta, entries: currencies },
    verify: verify(
      "c_Moneda",
      currencies.map((e) => e.code),
    ),
  },
  c_TipoDeComprobante: {
    data: { ...documentTypeTable.meta, entries: documentTypes },
    verify: verify(
      "c_TipoDeComprobante",
      documentTypes.map((e) => e.code),
    ),
  },
  c_Exportacion: {
    data: { ...exportTable.meta, entries: exports },
    verify: verify(
      "c_Exportacion",
      exports.map((e) => e.code),
    ),
  },
  c_ObjetoImp: {
    data: { ...taxObjectTable.meta, entries: taxObjects },
    verify: verify(
      "c_ObjetoImp",
      taxObjects.map((e) => e.code),
    ),
  },
  c_Impuesto: {
    data: { ...taxTable.meta, entries: taxes },
    verify: verify(
      "c_Impuesto",
      taxes.map((e) => e.code),
    ),
  },
  c_TipoFactor: {
    data: { ...factorTable.meta, entries: factors },
    verify: verify(
      "c_TipoFactor",
      factors.map((e) => e.code),
    ),
  },
  c_TasaOCuota: {
    data: { ...rateTable.meta, entries: rates },
    verify: {
      complete: rates.length > 0,
      verification: {
        method:
          "no XSD enumeration exists for c_TasaOCuota; every row's tax and factor resolve to c_Impuesto and c_TipoFactor",
        xlsRows: rates.length,
      },
    },
  },
  c_ClaveUnidad: {
    data: {
      ...unitTable.meta,
      format: "c_ClaveUnidad|validFrom|validTo|symbol|name",
      entries: units,
    },
    verify: verify(
      "c_ClaveUnidad",
      units.map((e) => e.split("|")[0]),
    ),
  },
  c_ClaveProdServ: {
    data: {
      ...productTable.meta,
      format:
        "c_ClaveProdServ|includeVat|includeIeps|complement|validFrom|validTo|borderStimulus",
      entries: products,
    },
    verify: verify(
      "c_ClaveProdServ",
      products.map((e) => e.split("|")[0]),
    ),
  },
};
const catalogs = {};
for (const [name, { data, verify: check }] of Object.entries(outputs)) {
  const compact = [
    "c_CodigoPostal",
    "c_ClaveUnidad",
    "c_ClaveProdServ",
  ].includes(name);
  const text = JSON.stringify(data, null, compact ? 0 : 2) + "\n";
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
      ...reverified,
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
      ...reverified,
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
        "c_FormaPago",
        "c_MetodoPago",
        "c_Moneda",
        "c_TipoDeComprobante",
        "c_Exportacion",
        "c_ObjetoImp",
        "c_Impuesto",
        "c_TipoFactor",
        "c_TasaOCuota",
        "c_ClaveUnidad",
        "c_ClaveProdServ",
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
    "xsdOnly=" + (entry.verification.xsdOnlyCodes?.length ?? "n/a"),
  );
