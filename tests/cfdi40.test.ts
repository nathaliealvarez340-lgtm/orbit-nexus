import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma } from "../src/generated/prisma/browser";
import type {
  StampedInvoice,
  StampedInvoiceConcept,
} from "../src/generated/prisma/client";
import cfdi40Manifest from "../src/lib/sat/cfdi40/manifest.json";
import catalogManifest from "../src/lib/sat/catcfdi/manifest.json";
import postalCatalog from "../src/lib/sat/catcfdi/c_CodigoPostal.json";
import { buildUnsignedCfdi40 } from "../src/lib/cfdi40/build";
import {
  inForce,
  loadCfdi40Catalogs,
  type Cfdi40Catalogs,
} from "../src/lib/cfdi40/catalogs";
import {
  CfdiDecimal,
  atLeast,
  canonical,
  conceptAmountWithinLimits,
  fixed,
  round,
  roundUp,
  taxAmountWithinLimits,
  truncate,
} from "../src/lib/cfdi40/decimal";
import {
  Cfdi40Error,
  cfdi40IssueCodes,
  type Cfdi40Issue,
} from "../src/lib/cfdi40/errors";
import { localIssueDateTime } from "../src/lib/cfdi40/issue-date";
import { mapOrbitInvoice } from "../src/lib/cfdi40/mapper";
import { normalizeCfdi40 } from "../src/lib/cfdi40/normalize";
import { orbitInvoiceForCfdi } from "../src/lib/cfdi40/orbit-invoice";
import {
  readCfdi40Resource,
  verifyCfdi40Resources,
} from "../src/lib/cfdi40/resources";
import { cfdi40SchemaValidator } from "../src/lib/cfdi40/schema";
import {
  cfdi40Namespace,
  cfdi40SchemaLocation,
  roundTrips,
  cfdi40Tree,
} from "../src/lib/cfdi40/serialize";
import type {
  Cfdi40Document,
  Cfdi40Transfer,
  OrbitInvoiceForCfdi,
  SealedCfdi40Xml,
  UnsignedCfdi40Xml,
} from "../src/lib/cfdi40/types";
import { validateCfdi40 } from "../src/lib/cfdi40/validate";
import {
  XmlSerializationError,
  escapeAttribute,
  serializeXml,
} from "../src/lib/cfdi40/xml";
import { describeError } from "../src/lib/security/redact";
import {
  issuedAt,
  issuer,
  orbitInvoice,
  receivers,
  validFixtures,
  type ConceptSpec,
} from "./fixtures/cfdi40";

// Fase 5C.4 (CFDI 4.0 XML, unsigned). Synthetic data only. "BUILDER_VALID" fixtures pass
// ORBIT's checks; none is SAT-XSD-validated (no approved XSD engine; and the unsigned XML
// cannot be XSD-valid without Sello, NoCertificado and Certificado).

let catalogs: Cfdi40Catalogs;
before(async () => {
  catalogs = await loadCfdi40Catalogs();
});
type Attempt =
  | { ok: true; result: ReturnType<typeof buildUnsignedCfdi40> }
  | { ok: false; issues: readonly Cfdi40Issue[] };
function attempt(invoice: OrbitInvoiceForCfdi, at: Date = issuedAt): Attempt {
  try {
    return {
      ok: true,
      result: buildUnsignedCfdi40(invoice, { issuedAt: at, catalogs }),
    };
  } catch (error) {
    if (error instanceof Cfdi40Error)
      return { ok: false, issues: error.issues };
    throw error;
  }
}
function build(invoice: OrbitInvoiceForCfdi, at: Date = issuedAt) {
  const outcome = attempt(invoice, at);
  if (!outcome.ok)
    assert.fail(
      "unexpected issues: " +
        outcome.issues.map((i) => `${i.code}@${i.path}`).join(", "),
    );
  return outcome.result;
}
function rejects(invoice: OrbitInvoiceForCfdi, code: string, rule?: string) {
  const outcome = attempt(invoice);
  assert(!outcome.ok, `expected ${code}, the CFDI was built`);
  const issue = outcome.issues.find((i) => i.code === code);
  assert(
    issue,
    `expected ${code}, got ${outcome.issues.map((i) => i.code).join(", ")}`,
  );
  if (rule) assert.equal(issue.rule, rule, code);
  assert(issue.category && issue.path && issue.message);
  return outcome.issues;
}
const one = (
  spec: Partial<ConceptSpec> = {},
  overrides: Partial<OrbitInvoiceForCfdi> = {},
) => orbitInvoice([{ quantity: "1", unitPrice: "1000", ...spec }], overrides);
const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const attr = (xml: string, element: string, name: string) =>
  new RegExp(`<cfdi:${element}\\b[^>]*\\s${name}="([^"]*)"`).exec(xml)?.[1];

// --- Official resources -------------------------------------------------------------------

test("official SAT resources are versioned locally with origin, date and SHA-256", async () => {
  const stored = cfdi40Manifest.resources.filter(
    (r) => typeof r.stored === "string",
  );
  assert.deepEqual(stored.map((r) => r.name).sort(), [
    "MatrizDeErrores_CFDI_v40_20260325.xls",
    "cadenaoriginal_4_0.xslt",
    "catCFDI.xsd",
    "cfdv40.xsd",
    "tdCFDI.xsd",
  ]);
  for (const r of cfdi40Manifest.resources) {
    assert.match(r.url, /^https?:\/\/(www|omawww)\.sat\.gob\.mx\//, r.name);
    assert.match(r.obtainedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    assert(r.purpose.length > 10);
    if (typeof r.stored === "string")
      assert.equal(sha256(await readFile(r.stored)), r.sha256, r.name);
  }
  assert((await verifyCfdi40Resources()).every((r) => r.ok));
  const cat = catalogManifest.sources.find((s) => s.name === "catCFDI.xsd")!;
  assert.equal(
    cfdi40Manifest.resources.find((r) => r.name === "catCFDI.xsd")!.sha256,
    cat.sha256,
  );
  assert.equal(cfdi40Manifest.namespace, cfdi40Namespace);
  assert.equal(
    cfdi40SchemaLocation,
    `${cfdi40Manifest.namespace} ${cfdi40Manifest.schemaLocation}`,
  );
  const xslt = cfdi40Manifest.resources.find(
    (r) => r.name === "cadenaoriginal_4_0.xslt",
  )!;
  assert.deepEqual(
    [xslt.xsltVersion, xslt.includesStored, xslt.executed],
    ["2.0", false, false],
  );
  assert(xslt.includes!.length > 20);
  // The CFDI module never downloads anything at runtime.
  for (const file of await readdir("src/lib/cfdi40")) {
    const text = await readFile(join("src/lib/cfdi40", file), "utf8");
    assert(
      !/\bfetch\(|node:https?|from "https?"|XMLHttpRequest/.test(text),
      file,
    );
  }
});

test("a modified or missing official resource is an error, never a fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "orbit-cfdi40-"));
  await mkdir(join(root, "resources/sat/cfdi40"), { recursive: true });
  const target = join(root, "resources/sat/cfdi40/tdCFDI.xsd");
  await copyFile("resources/sat/cfdi40/tdCFDI.xsd", target);
  assert.equal((await readCfdi40Resource("tdCFDI.xsd", root)).length, 7315);
  const bytes = await readFile(target);
  bytes[100] ^= 1;
  await writeFile(target, bytes);
  await assert.rejects(
    readCfdi40Resource("tdCFDI.xsd", root),
    (e: unknown) =>
      e instanceof Cfdi40Error && e.issues[0].code === "SAT_RESOURCE_CORRUPT",
  );
  await assert.rejects(
    readCfdi40Resource("cfdv40.xsd", root),
    (e: unknown) =>
      e instanceof Cfdi40Error && e.issues[0].code === "SAT_RESOURCE_MISSING",
  );
});

test("cfdv40.xsd makes Sello, NoCertificado and Certificado required: the unsigned XML never has them", async () => {
  const xsd = await readFile("resources/sat/cfdi40/cfdv40.xsd", "utf8");
  for (const name of ["Sello", "NoCertificado", "Certificado"])
    assert.match(
      xsd,
      new RegExp(`<xs:attribute name="${name}"[^>]*use="required"`),
      name,
    );
  const { xml } = build(validFixtures["ingreso-pue-iva16"].invoice()).xml;
  assert(!/\s(Sello|NoCertificado|Certificado)=/.test(xml));
});

// --- Catalogs -------------------------------------------------------------------------------

test("official catalogs: decimals, rates, product flags, XSD-only codes and validity", () => {
  assert.equal(catalogs.currency("MXN")?.decimals, 2);
  assert.equal(catalogs.currency("JPY")?.decimals, 0);
  assert.equal(catalogs.currency("ZZZ"), undefined);
  assert(
    catalogs.rates.some(
      (r) =>
        r.tax === "002" &&
        r.factor === "Tasa" &&
        r.kind === "FIXED" &&
        r.max === "0.160000" &&
        r.transfer,
    ),
  );
  assert(
    catalogs.rates.some(
      (r) =>
        r.tax === "001" &&
        r.kind === "RANGE" &&
        r.max === "0.350000" &&
        r.withholding,
    ),
  );
  assert.equal(catalogs.product("80111701")?.includeVat, "S");
  assert.equal(catalogs.product("84111506")?.includeVat, "O");
  assert.equal(catalogs.product("11131601"), undefined);
  assert.equal(catalogs.productInXsdOnly("11131601"), true);
  assert.equal(catalogs.unitInXsdOnly("DX"), true);
  assert.equal(catalogs.unit("E48")?.validFrom, "2022-01-01");
  assert.equal(catalogs.tax("001")?.transfer, false);
  assert.equal(
    catalogs.postalCode("06600")?.timeZone.description,
    "Tiempo del Centro",
  );
  assert.equal(
    inForce({ validFrom: "2022-01-01", validTo: "2026-10-12" }, "2026-10-12"),
    true,
  );
  assert.equal(
    inForce({ validFrom: "2022-01-01", validTo: "2026-10-11" }, "2026-10-12"),
    false,
  );
  assert.equal(
    inForce({ validFrom: "2026-10-13", validTo: null }, "2026-10-12"),
    false,
  );
  for (const name of [
    "c_FormaPago",
    "c_MetodoPago",
    "c_Moneda",
    "c_Exportacion",
    "c_ObjetoImp",
    "c_Impuesto",
    "c_TipoFactor",
    "c_ClaveUnidad",
    "c_ClaveProdServ",
  ] as const) {
    const entry = catalogManifest.catalogs[name];
    assert.equal(entry.complete, true, name);
    assert.deepEqual(entry.verification.codesMissingFromXsd, [], name);
  }
});

// --- Decimals -------------------------------------------------------------------------------

test("decimal arithmetic is exact and follows the Anexo 20 rounding and limits", () => {
  const d = (v: string) => new CfdiDecimal(v);
  assert.equal(round(d("2.345"), 2).toFixed(2), "2.35");
  assert.equal(round(d("0.125"), 2).toFixed(2), "0.13");
  assert.equal(d("0.1").add("0.2").toFixed(), "0.3");
  // Guía de llenado, pregunta 41: MXN, importe 924.224956.
  assert.equal(truncate(d("924.224956"), 2).toFixed(2), "924.22");
  assert.equal(roundUp(d("924.224956"), 2).toFixed(2), "924.23");
  assert.equal(fixed(d("-0"), 2), "0.00");
  assert.equal(canonical(d("1.5000")), "1.5");
  assert.equal(atLeast(d("1230"), 2), "1230.00");
  assert.equal(atLeast(d("12.3456"), 2), "12.3456");
  // Guía de llenado, Importe: 3.141649 × 1230.00 = 3864.22827.
  assert(conceptAmountWithinLimits("3.141649", "1230.00", "3864.22827"));
  assert(conceptAmountWithinLimits("3.141649", "1230.00", "3864.23"));
  // Official limits for 3.141649 × 1230.00 at 2 decimals: [3864.21, 3864.25].
  assert(conceptAmountWithinLimits("3.141649", "1230.00", "3864.25"));
  assert(!conceptAmountWithinLimits("3.141649", "1230.00", "3864.26"));
  assert(conceptAmountWithinLimits("3.141649", "1230.00", "3864.21"));
  assert(!conceptAmountWithinLimits("3.141649", "1230.00", "3864.20"));
  assert(taxAmountWithinLimits("1000.00", "0.160000", "160.00"));
  assert(taxAmountWithinLimits("1000.00", "0.160000", "160.01"));
  assert(!taxAmountWithinLimits("1000.00", "0.160000", "160.02"));
  // The exact rounding of any product is always inside the official limits.
  for (const [q, v] of [
    ["0.3333", "10.00"],
    ["2.5", "0.01"],
    ["7", "33.33"],
    ["0.0001", "10.04"],
  ])
    assert(conceptAmountWithinLimits(q, v, fixed(d(q).mul(v), 2)), `${q}x${v}`);
});

// --- Fecha ----------------------------------------------------------------------------------

test("Fecha is the local time of LugarExpedicion from a server instant", () => {
  const zone = (cp: string) => catalogs.postalCode(cp)!.timeZone;
  const at = (iso: string, cp: string) =>
    localIssueDateTime(new Date(iso), zone(cp))?.issuedAt;
  assert.equal(at("2026-10-12T18:30:15.999Z", "06600"), "2026-10-12T12:30:15");
  assert.equal(at("2026-10-12T18:30:15Z", "77500"), "2026-10-12T13:30:15");
  assert.equal(at("2026-10-12T18:30:15Z", "83000"), "2026-10-12T11:30:15");
  assert.equal(at("2026-01-01T05:59:59Z", "06600"), "2025-12-31T23:59:59");
  // Noroeste (21000): DST second Sunday of March to first Sunday of November.
  assert.equal(at("2026-03-08T09:59:59Z", "21000"), "2026-03-08T01:59:59");
  assert.equal(at("2026-03-08T10:00:00Z", "21000"), "2026-03-08T03:00:00");
  assert.equal(at("2026-11-01T08:59:59Z", "21000"), "2026-11-01T01:59:59");
  assert.equal(at("2026-11-01T09:00:00Z", "21000"), "2026-11-01T01:00:00");
  // 32000: the published summer offset (-7) is not one hour ahead of winter (-6): unresolved.
  assert.equal(
    localIssueDateTime(new Date("2026-10-12T18:30:15Z"), zone("32000")),
    null,
  );
  assert.equal(localIssueDateTime(new Date(Number.NaN), zone("06600")), null);
  assert.deepEqual(postalCatalog.timeZones[3].summer.utcOffset, "-7");
});

// --- XML writer -----------------------------------------------------------------------------

test("XML escaping and writing are centralized and strict", () => {
  assert.equal(
    escapeAttribute(`a & b < c > d "e" 'f'`),
    "a &amp; b &lt; c &gt; d &quot;e&quot; 'f'",
  );
  assert.equal(escapeAttribute("x\ty\nz\r"), "x&#9;y&#10;z&#13;");
  assert.equal(escapeAttribute("Ñandú \u{1F680}"), "Ñandú \u{1F680}");
  for (const bad of [
    "\u0000",
    "\u0008",
    "\uD800",
    "a\uDC00b",
    "\uFFFE",
    "\uFFFF",
  ])
    assert.throws(() => escapeAttribute(bad), XmlSerializationError);
  const leaf = {
    name: "cfdi:A",
    attributes: [["B", "1"]] as const,
    children: [],
  };
  assert.equal(
    serializeXml({ name: "cfdi:R", attributes: [], children: [leaf, leaf] }),
    '<?xml version="1.0" encoding="UTF-8"?><cfdi:R><cfdi:A B="1"/><cfdi:A B="1"/></cfdi:R>',
  );
  assert.throws(
    () => serializeXml({ name: "bad name", attributes: [], children: [] }),
    XmlSerializationError,
  );
  assert.throws(
    () =>
      serializeXml({
        name: "a",
        attributes: [
          ["b", "1"],
          ["b", "2"],
        ],
        children: [],
      }),
    XmlSerializationError,
  );
  assert.throws(
    () => serializeXml({ name: "a", attributes: [['x"y', "1"]], children: [] }),
    XmlSerializationError,
  );
});

// --- Builder --------------------------------------------------------------------------------

test("Ingreso PUE IVA 16% matches the hand-written reference XML byte for byte", async () => {
  const result = build(validFixtures["ingreso-pue-iva16"].invoice());
  const reference = await readFile(
    "tests/fixtures/cfdi40/ingreso-pue-iva16.unsigned.xml",
  );
  assert.equal(result.xml.xml, reference.toString("utf8"));
  assert.deepEqual(Buffer.from(result.xml.bytes), reference);
  assert.equal(result.xml.sha256, sha256(reference));
  assert.equal(result.xml.stage, "UNSIGNED");
  assert.deepEqual(result.schemaValidation, {
    status: "NOT_VALIDATED",
    reason: "UNSIGNED_REPRESENTATION",
  });
});

test("every builder-valid fixture builds deterministically, round-trips and stays unsigned", () => {
  for (const [name, fixture] of Object.entries(validFixtures)) {
    assert.equal(fixture.status, "BUILDER_VALID");
    const first = build(fixture.invoice());
    const second = build(fixture.invoice());
    assert.equal(first.xml.xml, second.xml.xml, name);
    assert.equal(first.xml.sha256, second.xml.sha256, name);
    const xml = first.xml.xml;
    assert(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0"',
      ),
      name,
    );
    assert(!/=""/.test(xml), name + ": empty attribute");
    assert(
      !/>\s+</.test(xml) && !/\n/.test(xml),
      name + ": whitespace between elements",
    );
    assert(
      !/\s(Sello|NoCertificado|Certificado|Confirmacion|CondicionesDePago|NoIdentificacion|Unidad)=/.test(
        xml,
      ),
      name,
    );
    assert(roundTrips(xml, cfdi40Tree(first.document)), name);
    assert.equal(Buffer.from(first.xml.bytes).toString("utf8"), xml);
  }
  // A different emission instant changes only Fecha.
  const later = build(
    validFixtures["ingreso-multiples-conceptos"].invoice(),
    new Date(issuedAt.getTime() + 3_600_000),
  );
  const base = build(validFixtures["ingreso-multiples-conceptos"].invoice());
  assert.equal(
    attr(later.xml.xml, "Comprobante", "Fecha"),
    "2026-10-12T13:30:15",
  );
  assert.equal(
    later.xml.xml.replace(/Fecha="[^"]*"/, ""),
    base.xml.xml.replace(/Fecha="[^"]*"/, ""),
  );
});

test("fixtures: PPD, exempt, discount, several tax groups, withholdings, USD, generic RFC and escaping", () => {
  const ppd = build(validFixtures["ingreso-ppd"].invoice()).xml.xml;
  assert.deepEqual(
    [
      attr(ppd, "Comprobante", "MetodoPago"),
      attr(ppd, "Comprobante", "FormaPago"),
    ],
    ["PPD", "99"],
  );

  const exempt = build(validFixtures["ingreso-exento"].invoice()).document;
  assert.deepEqual(exempt.concepts[0].taxes?.transfers, [
    { base: "800.00", tax: "002", factor: "Exento", rate: null, amount: null },
  ]);
  assert.deepEqual(
    [exempt.taxes?.totalTransferred, exempt.total],
    [null, "800.00"],
  );

  const discount = build(validFixtures["ingreso-descuento"].invoice()).document;
  assert.deepEqual(
    [
      discount.concepts[0].amount,
      discount.concepts[0].discount,
      discount.discount,
    ],
    ["2500.00", "250.00", "250.00"],
  );
  assert.equal(discount.concepts[0].taxes?.transfers[0].base, "2250.00");
  assert.equal(discount.total, "2610.00");

  const many = build(
    validFixtures["ingreso-multiples-conceptos"].invoice(),
  ).document;
  assert.deepEqual(
    many.taxes?.transfers.map((t) => [t.factor, t.rate, t.base, t.amount]),
    [
      ["Tasa", "0.160000", "2903.33", "464.53"],
      ["Tasa", "0.000000", "149.99", "0.00"],
      ["Exento", null, "250.50", null],
    ],
  );
  assert.deepEqual(many.taxes?.withholdings, [
    { tax: "001", amount: "290.00" },
    { tax: "002", amount: "309.33" },
  ]);
  assert.deepEqual(
    [many.concepts[3].quantity, many.concepts[3].amount],
    ["0.3333", "3.33"],
  );
  assert.equal(many.concepts[4].taxes, null);
  assert.deepEqual(
    [
      many.subtotal,
      many.discount,
      many.taxes?.totalTransferred,
      many.taxes?.totalWithheld,
      many.total,
    ],
    ["3523.82", "100.00", "464.53", "599.33", "3289.02"],
  );

  const withholding = build(
    validFixtures["ingreso-retenciones-persona-moral"].invoice(),
  ).document;
  assert.deepEqual(
    withholding.concepts[0].taxes?.withholdings.map((w) => [
      w.tax,
      w.rate,
      w.amount,
    ]),
    [
      ["001", "0.100000", "1000.00"],
      ["002", "0.106667", "1066.67"],
    ],
  );
  assert.equal(withholding.total, "9533.33");

  const usd = build(validFixtures["ingreso-usd-tipo-cambio"].invoice()).xml.xml;
  assert.deepEqual(
    [
      attr(usd, "Comprobante", "Moneda"),
      attr(usd, "Comprobante", "TipoCambio"),
    ],
    ["USD", "17.2543"],
  );
  const mxnOne = build(one({}, { exchangeRate: "1" })).xml.xml;
  assert.equal(attr(mxnOne, "Comprobante", "TipoCambio"), undefined);

  const generic = build(
    validFixtures["ingreso-rfc-generico-nacional"].invoice(),
  ).document;
  assert.deepEqual(
    [
      generic.receiver.rfc,
      generic.receiver.fiscalRegime,
      generic.receiver.fiscalAddressPostalCode,
      generic.receiver.cfdiUse,
    ],
    ["XAXX010101000", "616", generic.placeOfIssue, "S01"],
  );

  const escaped = build(validFixtures["ingreso-unicode-escape"].invoice());
  assert.equal(
    attr(escaped.xml.xml, "Emisor", "Nombre"),
    "PEÑA &amp; ASOCIADOS",
  );
  assert.equal(
    attr(escaped.xml.xml, "Receptor", "Nombre"),
    "CAFÉ &lt;EL SOL&gt;",
  );
  assert.equal(
    escaped.document.concepts[0].description,
    "Diseño & \"montaje\" <ÑANDÚ> 'año' 2026 \u{1F680}",
  );
  assert(
    escaped.xml.xml.includes(
      "Diseño &amp; &quot;montaje&quot; &lt;ÑANDÚ&gt; 'año' 2026 \u{1F680}",
    ),
  );
  // NFC: a decomposed "É" is written composed.
  const decomposed = build(one({ description: "CAFE\u0301" })).document;
  assert.equal(decomposed.concepts[0].description, "CAF\u00C9");
});

test("out-of-scope documents fail explicitly instead of producing approximate XML", () => {
  rejects(one({}, { documentType: "E" }), "DOCUMENT_TYPE_UNSUPPORTED");
  rejects(one({}, { documentType: "T" }), "DOCUMENT_TYPE_UNSUPPORTED");
  rejects(one({}, { exportCode: "02" }), "EXPORT_UNSUPPORTED");
  rejects(one({}, { exportCode: "03" }), "EXPORT_UNSUPPORTED");
  rejects(
    one(
      {},
      {
        receiverSnapshot: {
          ...receivers.company,
          rfc: "XEXX010101000",
          country: "USA",
          foreignTaxId: "123456789",
        },
      },
    ),
    "FOREIGN_RECEIVER_UNSUPPORTED",
  );
  rejects(
    one(
      {},
      {
        receiverSnapshot: {
          ...receivers.generic,
          legalName: "Público en General",
        },
        cfdiUse: "S01",
      },
    ),
    "GLOBAL_INVOICE_UNSUPPORTED",
    "CFDI40130",
  );
  rejects(one({ vatRate: "0.08" }), "VAT_BORDER_RATE_UNSUPPORTED");
  rejects(
    one({ productCode: "15101505", unitCode: "LTR" }),
    "PRODUCT_COMPLEMENT_UNSUPPORTED",
    "CFDI40228",
  );
  rejects(
    one({}, { currency: "JPY", exchangeRate: "0.12" }),
    "CURRENCY_UNSUPPORTED",
  );
  rejects(one({}, { currency: "XXX" }), "CURRENCY_UNSUPPORTED");
  rejects(one({ taxObject: "05", vatRate: null }), "TAX_OBJECT_UNSUPPORTED");
  const draft = {
    ...mapOrbitInvoice(one()),
    relatedDocuments: [
      { relationType: "04", uuids: ["6E05BB78-09F7-40C4-943E-31E4D6379498"] },
    ],
  };
  const related = normalizeCfdi40(draft, { issuedAt, catalogs });
  assert(
    !related.ok &&
      related.issues.some((i) => i.code === "RELATED_CFDI_UNSUPPORTED"),
  );
});

test("invalid data is rejected with stable codes and official rules", () => {
  const company = receivers.company;
  rejects(
    one({}, { receiverSnapshot: { ...company, rfc: "SCB021302CD2" } }),
    "RFC_INVALID",
    "XSD:Rfc",
  );
  rejects(one({}, { cfdiUse: "D01" }), "CFDI_USE_INCOMPATIBLE", "CFDI40161");
  rejects(
    one({}, { receiverSnapshot: { ...company, fiscalRegime: "612" } }),
    "REGIME_PERSON_TYPE_MISMATCH",
    "CFDI40158",
  );
  rejects(
    one({}, { issuerSnapshot: { ...issuer, fiscalRegime: "999" } }),
    "CATALOG_CODE_UNKNOWN",
    "CFDI40140",
  );
  rejects(
    one(
      {},
      {
        receiverSnapshot: { ...receivers.generic, fiscalRegime: "605" },
        cfdiUse: "S01",
      },
    ),
    "GENERIC_RECEIVER_REGIME",
    "CFDI40159",
  );
  rejects(
    one(
      {},
      {
        receiverSnapshot: { ...receivers.generic, postalCode: "64000" },
        cfdiUse: "S01",
      },
    ),
    "GENERIC_RECEIVER_POSTAL_CODE",
    "CFDI40149",
  );
  rejects(
    one(
      { withholdingIsrRate: "0.1" },
      { receiverSnapshot: receivers.generic, cfdiUse: "S01" },
    ),
    "GENERIC_RECEIVER_WITHHOLDING",
  );
  rejects(
    one({}, { paymentMethod: "PPD", paymentForm: "03" }),
    "PAYMENT_PPD_REQUIRES_99",
    "CFDI40105",
  );
  rejects(one({}, { paymentForm: "99" }), "PAYMENT_PUE_FORM_UNDEFINED");
  rejects(one({}, { paymentForm: "16" }), "CATALOG_CODE_UNKNOWN", "CFDI40104");
  rejects(
    one({}, { exchangeRate: "17.5" }),
    "EXCHANGE_RATE_NOT_ALLOWED",
    "CFDI40114",
  );
  rejects(one({}, { currency: "USD" }), "EXCHANGE_RATE_MISSING", "CFDI40115");
  rejects(
    one({ productCode: "99999999" }),
    "CATALOG_CODE_UNKNOWN",
    "CFDI40162",
  );
  rejects(
    one({ productCode: "11131601" }),
    "CATALOG_CODE_UNVERIFIABLE",
    "CFDI40162",
  );
  rejects(one({ unitCode: "ZZZ" }), "CATALOG_CODE_UNKNOWN", "CFDI40165");
  rejects(
    one({ productCode: "80111701", taxObject: "01", vatRate: null }),
    "PRODUCT_REQUIRES_VAT",
    "CFDI40164",
  );
  rejects(
    one({ taxObject: "01", vatRate: "0.16" }),
    "TAX_OBJECT_FORBIDS_TAXES",
    "CFDI40172",
  );
  rejects(
    one({ vatFactor: "EXENTO", vatRate: "0.16" }),
    "EXEMPT_WITH_RATE",
    "CFDI40177",
  );
  rejects(one({ vatRate: "0.15" }), "RATE_NOT_IN_CATALOG", "CFDI40179");
  rejects(
    one({ withholdingVatRate: "0.2" }),
    "RATE_NOT_IN_CATALOG",
    "CFDI40185",
  );
  rejects(
    one({ withholdingVatRate: "0.16", vatRate: "0" }),
    "WITHHOLDING_VAT_EXCEEDS_TRANSFER",
  );
  rejects(
    one({ withholdingVatRate: "0.1", vatFactor: "EXENTO", vatRate: null }),
    "WITHHOLDING_VAT_WITHOUT_TRANSFER",
  );
  rejects(
    one({ withholdingIsrRate: "0.4" }),
    "RATE_NOT_IN_CATALOG",
    "CFDI40185",
  );
  rejects(one({ discount: "1000" }), "TAX_BASE_NOT_POSITIVE", "CFDI40174");
  rejects(one({ unitPrice: "0" }), "UNIT_PRICE_NOT_POSITIVE", "CFDI40166");
  rejects(
    one({ description: "Servicio | mensual" }),
    "TEXT_PIPE_NOT_ALLOWED",
    "XSD:Descripcion",
  );
  rejects(
    one({ description: "Servicio\u0007mensual" }),
    "TEXT_INVALID_CHARACTER",
  );
  rejects(one({ description: "x".repeat(1001) }), "TEXT_TOO_LONG");
  rejects(one({ description: "   " }), "TEXT_REQUIRED");
  rejects(
    one({}, { issuerSnapshot: { ...issuer, legalName: "" } }),
    "ISSUER_DATA_MISSING",
  );
  rejects(one({}, { receiverSnapshot: null }), "RECEIVER_DATA_MISSING");
  rejects(one({}, { status: "DRAFT" }), "INVOICE_NOT_READY");
  rejects(
    one({}, { invoiceDate: "2026-10-11" }),
    "ISSUE_DATE_DIFFERS_FROM_DRAFT",
  );
  rejects(
    one({}, { issuerSnapshot: { ...issuer, postalCode: "32000" } }),
    "ISSUE_TIME_ZONE_UNRESOLVED",
  );
  rejects(
    one({}, { issuerSnapshot: { ...issuer, postalCode: "00001" } }),
    "PLACE_OF_ISSUE_UNKNOWN",
    "CFDI40126",
  );
  // Discounts above the amount cannot be stored by ORBIT; the builder rejects them anyway.
  const tooMuch = one({ discount: "1000" });
  const line = tooMuch.concepts[0];
  rejects(
    {
      ...tooMuch,
      concepts: [
        {
          ...line,
          discount: "1000.01",
          totals: { ...line.totals, discount: "1000.01" },
        },
      ],
    },
    "DISCOUNT_EXCEEDS_AMOUNT",
    "CFDI40169",
  );
});

test("amounts that differ from what ORBIT persisted are never corrected silently", () => {
  const invoice = one();
  rejects(
    { ...invoice, totals: { ...invoice.totals, total: "1160.01" } },
    "ORBIT_TOTALS_MISMATCH",
  );
  rejects(
    { ...invoice, totals: { ...invoice.totals, transferred: "159.99" } },
    "ORBIT_TOTALS_MISMATCH",
  );
  const concept = invoice.concepts[0];
  rejects(
    {
      ...invoice,
      concepts: [
        { ...concept, totals: { ...concept.totals, amount: "1000.01" } },
      ],
    },
    "ORBIT_TOTALS_MISMATCH",
  );
  rejects(
    { ...invoice, concepts: [{ ...concept, appliedVatRate: "0" }] },
    "ORBIT_TOTALS_MISMATCH",
  );
});

test("the validator independently rejects inconsistent documents", () => {
  const valid = build(
    orbitInvoice([
      { quantity: "1", unitPrice: "1000" },
      { quantity: "2", unitPrice: "50", vatFactor: "EXENTO", vatRate: null },
    ]),
  ).document;
  assert.deepEqual(validateCfdi40(valid, catalogs), []);
  const check = (doc: Cfdi40Document, code: string, rule?: string) => {
    const issues = validateCfdi40(doc, catalogs);
    const issue = issues.find((i) => i.code === code);
    assert(
      issue,
      `expected ${code}, got ${issues.map((i) => i.code).join(", ")}`,
    );
    if (rule) assert.equal(issue.rule, rule);
  };
  const concept = valid.concepts[0];
  const transfer = concept.taxes!.transfers[0];
  const withConcept = (c: Partial<typeof concept>) => ({
    ...valid,
    concepts: [{ ...concept, ...c }, valid.concepts[1]],
  });
  check({ ...valid, subtotal: "1100.01" }, "SUBTOTAL_MISMATCH", "CFDI40108");
  check(
    { ...valid, subtotal: "1100.001" },
    "AMOUNT_DECIMALS_EXCEED_CURRENCY",
    "CFDI40107",
  );
  check({ ...valid, total: "1260.01" }, "TOTAL_MISMATCH", "CFDI40119");
  check({ ...valid, discount: "1.00" }, "DISCOUNT_TOTAL_MISMATCH", "CFDI40111");
  check(
    { ...valid, issuedAt: "2026-10-12 12:30:15" },
    "VALUE_PATTERN_MISMATCH",
    "CFDI40101",
  );
  check(
    withConcept({ amount: "1600.00" }),
    "CONCEPT_AMOUNT_OUT_OF_LIMITS",
    "CFDI40167",
  );
  check(
    withConcept({ amount: "1000.10" }),
    "CONCEPT_AMOUNT_NOT_EXACT",
    "ORBIT",
  );
  check(
    withConcept({
      taxes: {
        transfers: [{ ...transfer, amount: "161.00" } as Cfdi40Transfer],
        withholdings: [],
      },
    }),
    "TAX_AMOUNT_OUT_OF_LIMITS",
    "CFDI40180",
  );
  check(
    withConcept({
      taxes: {
        transfers: [{ ...transfer, amount: "160.01" } as Cfdi40Transfer],
        withholdings: [],
      },
    }),
    "TAX_AMOUNT_NOT_EXACT",
    "ORBIT",
  );
  check(
    withConcept({
      taxes: {
        transfers: [
          { ...transfer, rate: "0.150000", amount: "150.00" } as Cfdi40Transfer,
        ],
        withholdings: [],
      },
    }),
    "RATE_NOT_IN_CATALOG",
    "CFDI40179",
  );
  check(withConcept({ taxes: null }), "TAX_OBJECT_REQUIRES_TAXES", "CFDI40171");
  const taxes = valid.taxes!;
  check(
    {
      ...valid,
      taxes: {
        ...taxes,
        transfers: [
          { ...taxes.transfers[0], amount: "160.01" } as Cfdi40Transfer,
          taxes.transfers[1],
        ],
      },
    },
    "TAX_SUMMARY_MISMATCH",
    "CFDI40221",
  );
  check(
    {
      ...valid,
      taxes: {
        ...taxes,
        transfers: [taxes.transfers[0], taxes.transfers[0], taxes.transfers[1]],
      },
    },
    "DUPLICATE_TAX_GROUP",
    "CFDI40218",
  );
  check(
    { ...valid, taxes: { ...taxes, totalTransferred: null } },
    "TAX_SUMMARY_MISMATCH",
    "CFDI40212",
  );
  check({ ...valid, taxes: null }, "TAX_SUMMARY_MISMATCH");
});

test("errors carry codes, paths and rules only, never fiscal values", () => {
  const invoice = one(
    { description: "Servicio | secreto", unitPrice: "4321.98" },
    {
      receiverSnapshot: {
        ...receivers.company,
        rfc: "ZZZ999999ZZZ",
        legalName: "NOMBRE CONFIDENCIAL",
      },
    },
  );
  let caught: unknown;
  try {
    buildUnsignedCfdi40(invoice, { issuedAt, catalogs });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Cfdi40Error);
  const serialized = JSON.stringify({
    message: caught.message,
    issues: caught.issues,
    error: caught,
  });
  for (const secret of [
    "ZZZ999999ZZZ",
    "CONFIDENCIAL",
    "secreto",
    "4321.98",
    "SCA010101AB1",
  ])
    assert(!serialized.includes(secret), secret);
  assert.equal(caught.message, "CFDI40_BUILD_FAILED");
  assert.deepEqual(describeError(caught), { name: "Cfdi40Error" });
  for (const code of cfdi40IssueCodes) assert.match(code, /^[A-Z0-9_]+$/);
});

test("the unsigned representation is not a sealed CFDI and no XSD validation is claimed", async () => {
  const { xml } = build(one());
  // @ts-expect-error An unsigned XML can never be used where a sealed CFDI is required.
  const sealed: SealedCfdi40Xml = xml;
  assert.equal(sealed.stage, "UNSIGNED");
  const unsigned: UnsignedCfdi40Xml = xml;
  assert.equal(unsigned.stage, "UNSIGNED");
  const placeholder = {
    ...xml,
    stage: "SEALED",
    certificate: { noCertificado: "", certificadoBase64: "" },
  } as SealedCfdi40Xml;
  // A cast defeats the compile-time brand, not the runtime gate.
  assert.deepEqual(await cfdi40SchemaValidator.validate(placeholder), {
    status: "REJECTED",
    reason: "NOT_SEALED_BY_ORBIT",
  });
});

test("adapter and mapper: Prisma record → ORBIT snapshot → CFDI vocabulary, without inventing data", () => {
  const D = (v: string) => new Prisma.Decimal(v);
  const concept = (position: number, id: string) => ({
    id,
    stampedInvoiceId: "inv",
    position,
    savedConceptId: null,
    description: "Servicio " + position,
    productCode: "84111506",
    unitCode: "E48",
    quantity: D("1.5000"),
    unitPrice: D("200.00"),
    discount: D("0.00"),
    taxObject: "02",
    vatFactor: "TASA",
    vatRate: D("0.160000"),
    taxRate: D("0.1600"),
    withholdingVatRate: null,
    withholdingIsrRate: null,
    subtotal: D("300.00"),
    transferredTaxes: D("48.00"),
    withheldVat: D("0.00"),
    withheldIsr: D("0.00"),
    total: D("348.00"),
  });
  const record = {
    id: "inv",
    organizationId: "org",
    userId: "u",
    uuid: null,
    status: "READY",
    version: 2,
    clientId: "c",
    folio: "ORB-000001",
    sequence: 1,
    invoiceDate: new Date("2026-10-12T00:00:00Z"),
    issuedAt: null,
    currency: "MXN",
    documentType: "I",
    cfdiUse: "G03",
    paymentForm: "03",
    paymentMethod: "PUE",
    issuerSnapshot: issuer,
    receiverSnapshot: { ...receivers.company, cfdiUse: "G01" },
    templateSnapshot: null,
    xmlDocumentId: null,
    pdfDocumentId: null,
    issuerRfc: issuer.rfc,
    receiverRfc: receivers.company.rfc,
    subtotal: D("600.00"),
    tax: D("96.00"),
    total: D("696.00"),
    exchangeRate: null,
    exportCode: "01",
    discount: D("0.00"),
    withheldVat: D("0.00"),
    withheldIsr: D("0.00"),
    validation: { valid: true },
    readyAt: null,
    idempotencyKey: null,
    xmlUrl: null,
    pdfUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    concepts: [concept(1, "b"), concept(0, "a")],
  } as unknown as StampedInvoice & { concepts: StampedInvoiceConcept[] };
  const snapshot = orbitInvoiceForCfdi(record);
  assert.deepEqual(
    snapshot.concepts.map((c) => c.description),
    ["Servicio 0", "Servicio 1"],
  );
  assert.deepEqual(
    [
      snapshot.concepts[0].quantity,
      snapshot.concepts[0].vatRate,
      snapshot.concepts[0].appliedVatRate,
    ],
    ["1.5", "0.16", "0.16"],
  );
  assert.deepEqual(
    [snapshot.invoiceDate, snapshot.totals.total, snapshot.exchangeRate],
    ["2026-10-12", "696", null],
  );
  const draft = mapOrbitInvoice(snapshot);
  assert.equal(
    draft.receiver.cfdiUse,
    "G03",
    "the invoice Uso CFDI, not the client default",
  );
  assert.equal(draft.issuer.name, issuer.legalName);
  assert.equal(draft.serie, null);
  assert.deepEqual(draft.relatedDocuments, []);
  assert.deepEqual(draft.concepts[0].vat, { factor: "Tasa", rate: "0.16" });
  // Missing snapshot fields stay null; nothing is defaulted from other data.
  assert.deepEqual(
    mapOrbitInvoice({
      ...snapshot,
      issuerSnapshot: { rfc: issuer.rfc, email: issuer.email },
    }).issuer,
    {
      rfc: issuer.rfc,
      name: null,
      personType: null,
      fiscalRegime: null,
      postalCode: null,
    },
  );
  assert.equal(snapshot.legacyRecord, false);
  const built = build(snapshot);
  assert.equal(built.document.total, "696.00");
  // Never saved by the Fase 5 rules: its fiscal fields may be migration defaults.
  const legacy = orbitInvoiceForCfdi({ ...record, validation: null });
  assert.equal(legacy.legacyRecord, true);
  rejects(legacy, "LEGACY_RECORD_REVIEW_REQUIRED");
});
