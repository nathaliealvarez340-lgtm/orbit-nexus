import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import manifest from "../src/lib/sat/catcfdi/manifest.json";
import {
  cfdiUseRules,
  fiscalRegimeCatalog,
  identityCatalogSource,
  officialRegimes,
} from "../src/lib/sat-catalogs";
import { postalCodeIndex } from "../src/lib/sat/postal-codes";
import { fiscalSchema } from "../src/lib/validation";
import { clientSchema, draftSchema } from "../src/lib/phase3-validation";
import { validateInvoice } from "../src/lib/invoice-rules";
import { calculateInvoiceTotals } from "../src/lib/invoice-totals";
import { extractPdfLines } from "../src/lib/csf/pdf-text";
import {
  extractionFieldKeys,
  parseCsfDate,
  parseCsfText,
  rfcCheckDigitValid,
} from "../src/lib/csf/parser";
import { syntheticCsf } from "./fixtures/synthetic-csf.mjs";
import {
  privacyNoticeBlocksProcessing,
  privacyNoticeVersion,
} from "../src/lib/privacy-notice";

const sha256 = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");

test("SAT resources: manifest origin, versions and SHA-256 match the versioned files", async () => {
  assert.equal(manifest.release, "catCFDI_V_4_20261001");
  for (const source of manifest.sources) {
    assert.match(source.url, /^http:\/\/(omawww|www)\.sat\.gob\.mx\//);
    assert.match(source.obtainedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
  }
  const xsdSource = manifest.sources.find((s) => s.name === "catCFDI.xsd")!;
  assert.equal(xsdSource.stored, "resources/sat/cfdi40/catCFDI.xsd");
  const xsd = await readFile("resources/sat/cfdi40/catCFDI.xsd");
  assert.equal(sha256(xsd), xsdSource.sha256);
  for (const entry of Object.values(manifest.catalogs)) {
    const file = await readFile("src/lib/sat/catcfdi/" + entry.file, "utf8");
    assert.equal(
      sha256(file),
      entry.sha256,
      entry.file + " was modified after generation",
    );
  }
});

test("SAT resources: every catalog code is re-verified against the official XSD before complete=true", async () => {
  const xsd = await readFile("resources/sat/cfdi40/catCFDI.xsd", "utf8");
  const enumeration = (name: string) => {
    const start = xsd.indexOf(`<xs:simpleType name="${name}">`);
    const end = xsd.indexOf("</xs:simpleType>", start);
    return new Set(
      [
        ...xsd.slice(start, end).matchAll(/<xs:enumeration value="([^"]*)"/g),
      ].map((m) => m[1]),
    );
  };
  const files = {
    c_RegimenFiscal: JSON.parse(
      await readFile("src/lib/sat/catcfdi/c_RegimenFiscal.json", "utf8"),
    ),
    c_UsoCFDI: JSON.parse(
      await readFile("src/lib/sat/catcfdi/c_UsoCFDI.json", "utf8"),
    ),
    c_CodigoPostal: JSON.parse(
      await readFile("src/lib/sat/catcfdi/c_CodigoPostal.json", "utf8"),
    ),
  };
  for (const [name, data] of Object.entries(files)) {
    const official = enumeration(name);
    const codes: string[] = data.entries.map((e: { code?: string } | string) =>
      typeof e === "string" ? e.slice(0, 5) : e.code!,
    );
    assert.equal(new Set(codes).size, codes.length, name + " duplicated codes");
    assert.deepEqual(
      codes.filter((c) => !official.has(c)),
      [],
      name + " codes outside the official XSD",
    );
    const recorded = manifest.catalogs[name as keyof typeof manifest.catalogs];
    assert.equal(recorded.complete, true);
    assert.equal(recorded.entries, codes.length);
  }
  assert.equal(identityCatalogSource.regimesComplete, true);
  assert.equal(identityCatalogSource.cfdiUsesComplete, true);
});

test("official régimen and Uso CFDI data replace hand-written catalogs", async () => {
  assert.equal(fiscalRegimeCatalog.length, 19);
  assert.deepEqual(officialRegimes.get("601")?.personTypes, ["COMPANY"]);
  assert.deepEqual(officialRegimes.get("612")?.personTypes, ["INDIVIDUAL"]);
  assert.deepEqual(officialRegimes.get("626")?.personTypes, [
    "INDIVIDUAL",
    "COMPANY",
  ]);
  assert.equal(
    officialRegimes.has("609"),
    false,
    "historic XSD-only codes are not offered",
  );
  // Official 2026 matrix: G02 admits 616, G03 does not.
  assert(cfdiUseRules.get("G02")!.receiverRegimes.includes("616"));
  assert(!cfdiUseRules.get("G03")!.receiverRegimes.includes("616"));
  const postal = await postalCodeIndex();
  const centro = postal.get("06000")!;
  assert.equal(centro.state, "CMX");
  assert.equal(centro.timeZone.description, "Tiempo del Centro");
  assert.equal(postal.has("00001"), false);
});

const profile = {
  rfc: "EKU9003173C9",
  legalName: "ESCUELA KEMPER URGATE",
  fiscalRegime: "601",
  postalCode: "42501",
  cfdiUse: "G03",
  email: "fiscal@example.test",
  personType: "COMPANY",
  confirmed: true,
};

test("fiscal profile validates régimen and Uso CFDI against the official catalog", () => {
  assert.equal(fiscalSchema.safeParse(profile).success, true);
  const issues = (data: Record<string, unknown>) => {
    const r = fiscalSchema.safeParse({ ...profile, ...data });
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };
  assert.deepEqual(issues({ fiscalRegime: "999" }), ["fiscalRegime"]);
  assert.deepEqual(issues({ fiscalRegime: "612" }), ["fiscalRegime"]);
  assert.deepEqual(issues({ fiscalRegime: "609" }), ["fiscalRegime"]);
  const individual = {
    rfc: "CACX7605101P8",
    personType: "INDIVIDUAL",
    fiscalRegime: "605",
  };
  assert.deepEqual(issues({ ...individual, cfdiUse: "G03" }), ["cfdiUse"]);
  assert.deepEqual(issues({ ...individual, cfdiUse: "D01" }), []);
  // Generic RFC: régimen 616 and Uso CFDI S01 only.
  const generic = {
    rfc: "XAXX010101000",
    personType: "INDIVIDUAL",
    fiscalRegime: "616",
  };
  assert.deepEqual(issues({ ...generic, cfdiUse: "G03" }), ["cfdiUse"]);
  assert.deepEqual(issues({ ...generic, cfdiUse: "S01" }), []);
});

const client = {
  rfc: "BBB010101BBB",
  legalName: "Cliente de prueba",
  personType: "COMPANY",
  fiscalRegime: "601",
  cfdiUse: "G03",
  email: "client@example.test",
  postalCode: "06000",
};

test("clients validate régimen/Uso CFDI and require confirmation for extracted data", () => {
  assert.equal(clientSchema.safeParse(client).success, true);
  assert.equal(
    clientSchema.safeParse({ ...client, fiscalRegime: "605" }).success,
    false,
  );
  assert.equal(
    clientSchema.safeParse({ ...client, cfdiUse: "D01" }).success,
    false,
  );
  assert.equal(
    clientSchema.safeParse({ ...client, extractionId: "x1" }).success,
    false,
  );
  assert.equal(
    clientSchema.safeParse({ ...client, extractionId: "x1", confirmed: true })
      .success,
    true,
  );
  assert.equal(
    clientSchema.safeParse({ ...client, organizationId: "other" }).success,
    true,
  );
  assert.equal(
    "organizationId" in
      clientSchema.parse({ ...client, organizationId: "other" }),
    false,
  );
});

test("unknown postal codes are blocking errors for READY", () => {
  const draft = draftSchema.parse({
    clientId: "c1",
    invoiceDate: "2026-10-08",
    documentType: "I",
    currency: "MXN",
    cfdiUse: "G03",
    paymentMethod: "PUE",
    paymentForm: "03",
    exportCode: "01",
    concepts: [
      {
        description: "Servicio",
        productCode: "81112200",
        unitCode: "E48",
        quantity: "1",
        unitPrice: "100",
        taxObject: "02",
        vatFactor: "TASA",
        vatRate: "0.16",
      },
    ],
  });
  const party = {
    rfc: "EKU9003173C9",
    legalName: "Emisor",
    personType: "COMPANY",
    fiscalRegime: "601",
    postalCode: "42501",
  };
  const result = validateInvoice({
    issuer: { ...party, profileComplete: true },
    receiver: { ...party, rfc: "BBB010101BBB", postalCode: "00001" },
    draft,
    totals: calculateInvoiceTotals(draft.concepts),
    isKnownPostalCode: (code) => code === "42501",
  });
  assert.deepEqual(
    result.issues.map((i) => [i.code, i.severity]),
    [["RECEIVER_POSTAL_CODE_UNVERIFIED", "ERROR"]],
  );
  assert.equal(result.canMarkReady, false);
});

async function extract(options: Parameters<typeof syntheticCsf>[0]) {
  const postal = await postalCodeIndex();
  return parseCsfText(await extractPdfLines(await syntheticCsf(options)), {
    isKnownPostalCode: (code) => postal.has(code),
  });
}

test("CSF parser: verified RFC and postal code are DETECTED, heuristics stay LOW_CONFIDENCE", async () => {
  const r = await extract({
    rfc: "EKU9003173C9",
    companyName: "ESCUELA KEMPER URGATE",
  });
  assert.equal(r.status, "PARTIAL");
  assert.deepEqual(
    Object.keys(r.fields).sort(),
    [...extractionFieldKeys].sort(),
  );
  assert.deepEqual(
    [
      r.fields.rfc.status,
      r.fields.personType.value,
      r.fields.postalCode.status,
      r.fields.legalName.status,
    ],
    ["DETECTED", "COMPANY", "DETECTED", "LOW_CONFIDENCE"],
  );
  assert.equal(r.fields.legalName.value, "ESCUELA KEMPER URGATE");
  assert.equal(r.fields.operationsStartDate.value, "1990-03-17");
  assert.equal(r.fields.interiorNumber.status, "NOT_FOUND");
  assert.equal(r.fields.country.status, "NOT_FOUND");
  assert.deepEqual(
    r.regimes.map((x) => [x.code, x.status, x.catalogVerified]),
    [["601", "LOW_CONFIDENCE", true]],
  );
  // Email and phone appear in the document but are never captured or inferred.
  assert(!JSON.stringify(r).includes("contacto@example.test"));
});

test("CSF parser keeps every regime, composes individual names and flags ambiguity", async () => {
  const r = await extract({
    rfc: "CACX7605101P8",
    names: ["XOCHILT", "CASAS", "CHAVEZ"],
    regimes: [
      [
        "Régimen de Sueldos y Salarios e Ingresos Asimilados a Salarios",
        "01/01/2015",
      ],
      ["Régimen Simplificado de Confianza", "01/01/2022"],
      ["Régimen de Incorporación Fiscal", "01/01/2014", "31/12/2021"],
      ["Régimen inventado para pruebas", "01/01/2023"],
    ],
  });
  assert.equal(r.fields.personType.value, "INDIVIDUAL");
  assert.equal(r.fields.legalName.value, "XOCHILT CASAS CHAVEZ");
  assert.deepEqual(
    r.regimes.map((x) => [x.code, x.endDate, x.catalogVerified]),
    [
      ["605", null, true],
      ["626", null, true],
      ["621", "2021-12-31", true],
      ["", null, false],
    ],
  );
  const ambiguous = await extract({
    rfc: "EKU9003173C9",
    extraRfc: "IIA040805DZ4",
    companyName: "X",
  });
  assert.equal(ambiguous.fields.rfc.status, "AMBIGUOUS");
  assert.deepEqual(ambiguous.fields.rfc.candidates, [
    "EKU9003173C9",
    "IIA040805DZ4",
  ]);
  assert.equal(ambiguous.fields.rfc.value, null);
  const unverified = await extract({
    rfc: "AAA010101AAA",
    companyName: "X",
    postalCode: "00001",
  });
  assert.equal(unverified.fields.rfc.status, "LOW_CONFIDENCE");
  assert.equal(unverified.fields.postalCode.status, "LOW_CONFIDENCE");
});

test("CSF parser never invents data from blank or unreadable documents", async () => {
  const blank = await extract({ blank: true });
  assert.equal(blank.status, "UNREADABLE");
  assert(
    Object.values(blank.fields).every(
      (f) => f.status === "NOT_FOUND" && f.value === null,
    ),
  );
  await assert.rejects(() =>
    extractPdfLines(Buffer.from("%PDF-1.7 not really a pdf")),
  );
  assert.equal(parseCsfText([]).status, "UNREADABLE");
  assert.equal(parseCsfDate("31 DE FEBRERO DE 2020"), null);
  assert.equal(rfcCheckDigitValid("EKU9003173C9"), true);
  assert.equal(rfcCheckDigitValid("EKU9003173C8"), false);
});

test("privacyNoticeVersion may be null only while fiscal production stays blocked", () => {
  assert.equal(privacyNoticeVersion({}), null);
  assert.equal(privacyNoticeVersion({ PRIVACY_NOTICE_VERSION: "  " }), null);
  assert.equal(privacyNoticeBlocksProcessing({}), false);
  assert.equal(privacyNoticeBlocksProcessing({ VERCEL_ENV: "preview" }), false);
  assert.equal(
    privacyNoticeBlocksProcessing({ VERCEL_ENV: "production" }),
    true,
  );
  assert.equal(
    privacyNoticeBlocksProcessing({ PAC_ENVIRONMENT: "PRODUCTION" }),
    true,
  );
  assert.equal(
    privacyNoticeBlocksProcessing({
      VERCEL_ENV: "production",
      PRIVACY_NOTICE_VERSION: "aviso-v1",
    }),
    false,
  );
});

test("phase 5C migration is additive, preserves rows and keeps consent and extraction tenant-scoped", async () => {
  const db = await PGlite.create();
  try {
    // Explicit, stable baseline: exactly the migrations that preceded Fase 5C-A Bloque 1.
    const before5C = [
      "202609200001_phase1",
      "202609200002_multitenant",
      "202609270001_phase3",
      "202609300001_ticket_intelligence",
      "202610010001_ticket_billing",
      "202610070001_phase5_fiscal_foundation",
    ];
    const phase5c = "202610080001_phase5c_fiscal_identity";
    const available = new Set(await readdir("prisma/migrations"));
    for (const name of [...before5C, phase5c])
      assert(available.has(name), name + " migration is missing");
    for (const name of before5C)
      await db.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
    await db.exec(`INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('u','U','u@example.test',NOW());
      INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('a','A',NOW()),('b','B',NOW());
      INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,"updatedAt") VALUES ('fp','u','a','EKU9003173C9','Legacy','601','42501','G03','f@example.test',NOW());
      INSERT INTO "Client" (id,"organizationId",rfc,"legalName","fiscalRegime","cfdiUse",email,"postalCode","updatedAt") VALUES ('ca','a','BBB010101BBB','Cliente','601','G03','c@example.test','06000',NOW());
      INSERT INTO "StampedInvoice" (id,"organizationId","userId","issuerRfc","receiverRfc",subtotal,tax,total,"updatedAt",status) VALUES ('inv','a','u','EKU9003173C9','BBB010101BBB',100,16,116,NOW(),'READY');
      INSERT INTO "Document" (id,"organizationId","uploadedById","fileName","mimeType",size,sha256,content,kind) VALUES ('doc-a','a','u','csf.pdf','application/pdf',0,'x',''::bytea,'CSF'),('doc-b','b','u','csf.pdf','application/pdf',0,'x',''::bytea,'CSF');`);
    const migration = await readFile(
      `prisma/migrations/${phase5c}/migration.sql`,
      "utf8",
    );
    assert(
      !/\b(DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|ALTER\s+COLUMN/i.test(migration),
    );
    await db.exec(migration);
    const invoice = (
      await db.query<{ version: number; status: string; total: string }>(
        `SELECT version, status::text, total::text FROM "StampedInvoice" WHERE id='inv'`,
      )
    ).rows[0];
    assert.deepEqual(invoice, { version: 1, status: "READY", total: "116.00" });
    const legacy = (
      await db.query<{ legalName: string; sourceExtractionId: string | null }>(
        `SELECT "legalName", "sourceExtractionId" FROM "FiscalProfile"`,
      )
    ).rows[0];
    assert.deepEqual(legacy, { legalName: "Legacy", sourceExtractionId: null });
    await db.exec(
      `INSERT INTO "FiscalDocumentConsent" (id,"organizationId","userId","documentId",purpose,"consentVersion") VALUES ('consent-a','a','u','doc-a','FISCAL_PROFILE_PREFILL','v1')`,
    );
    // A consent can never point at another Organization's document or client.
    await assert.rejects(
      db.exec(
        `INSERT INTO "FiscalDocumentConsent" (id,"organizationId","userId","documentId",purpose,"consentVersion") VALUES ('x','a','u','doc-b','FISCAL_PROFILE_PREFILL','v1')`,
      ),
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "FiscalDocumentConsent" (id,"organizationId","userId","documentId",purpose,"consentVersion","clientId") VALUES ('y','b','u','doc-b','CLIENT_FISCAL_PREFILL','v1','ca')`,
      ),
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "FiscalDocumentExtraction" (id,"organizationId","consentId","documentId",purpose,"createdById",status,"parserVersion",fields,regimes) VALUES ('z','b','consent-a','doc-b','FISCAL_PROFILE_PREFILL','u','PARTIAL','v','{}','[]')`,
      ),
    );
    await assert.rejects(
      db.exec(`UPDATE "Client" SET "csfDocumentId"='doc-b' WHERE id='ca'`),
    );
  } finally {
    await db.close();
  }
});
