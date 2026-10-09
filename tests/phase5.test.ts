import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { cfdiUses, paymentForms } from "../src/lib/fiscal-catalogs";
import {
  catalogCodes,
  cfdiUseRules,
  invoiceFiscalCatalogs,
  regimePersonTypes,
} from "../src/lib/sat-catalogs";
import { largeCatalogSources } from "../src/lib/sat-catalogs-large";
import { searchCatalog } from "../src/lib/fiscal-catalog-search";
import {
  calculateInvoiceTotals,
  invoiceTotals,
  serializeInvoiceTotals,
} from "../src/lib/invoice-totals";
import {
  draftSchema,
  savedConceptSchema,
  updateDraftSchema,
  type InvoiceDraftInput,
} from "../src/lib/phase3-validation";
import {
  issuesFromStructure,
  validateInvoice,
  type InvoiceRuleInput,
} from "../src/lib/invoice-rules";

test("small SAT catalogs are a single source with unique codes and Fase 5 availability", () => {
  for (const [name, catalog] of Object.entries(invoiceFiscalCatalogs)) {
    const codes = catalog.map((o) => o.code);
    assert.equal(new Set(codes).size, codes.length, name + " has duplicates");
    assert(catalog.every((o) => o.label && typeof o.active === "boolean"));
  }
  // Phase 3 tuples are derived views, not a second copy.
  assert.deepEqual(
    cfdiUses.map(([code]) => code),
    invoiceFiscalCatalogs.cfdiUses.map((o) => o.code),
  );
  assert.equal(paymentForms.length, 22);
  const active = (list: { code: string; active: boolean }[]) =>
    list.filter((o) => o.active).map((o) => o.code);
  assert.deepEqual(active(invoiceFiscalCatalogs.documentTypes), ["I"]);
  assert(!active(invoiceFiscalCatalogs.cfdiUses).includes("CP01"));
  assert(!active(invoiceFiscalCatalogs.exportCodes).includes("02"));
  assert.deepEqual(active(invoiceFiscalCatalogs.taxObjects), [
    "01",
    "02",
    "03",
    "04",
  ]);
  for (const [, rule] of cfdiUseRules)
    for (const regime of rule.receiverRegimes)
      assert(regimePersonTypes.has(regime));
  assert(catalogCodes.paymentForm.has("99"));
});

test("large catalog search ranks code matches, ignores accents, bounds results and never claims completeness", () => {
  const products = largeCatalogSources["product-services"];
  assert.equal(products.complete, false);
  assert.equal(products.source, "CURATED_SUBSET");
  assert.equal(products.search("81112200")[0].code, "81112200");
  assert.equal(products.search("8111")[0].code.startsWith("8111"), true);
  assert(products.search("consultoria").some((o) => o.code === "80101500"));
  assert(largeCatalogSources.units.search("día").some((o) => o.code === "DAY"));
  assert.deepEqual(Object.keys(products.search("auditoria")[0]).sort(), [
    "active",
    "code",
    "label",
  ]);
  const many = Array.from({ length: 200 }, (_, i) => ({
    code: String(i),
    label: "Servicio " + i,
    active: true,
  }));
  assert.equal(searchCatalog(many, "servicio", 999).length, 50);
  assert.equal(searchCatalog(many, "", undefined).length, 20);
  assert.equal(products.has("01010101"), true);
  assert.equal(products.has("12345678"), false);
});

test("totals use Decimal per line: discount base, VAT, exempt, withholdings and the Phase 3 shape", () => {
  const t = calculateInvoiceTotals([
    {
      quantity: "1",
      unitPrice: "1100.00",
      discount: "100.00",
      taxObject: "02",
      vatFactor: "TASA",
      vatRate: "0.16",
      withholdingVatRate: "0.106667",
      withholdingIsrRate: "0.10",
    },
    { quantity: "3", unitPrice: "0.10", taxObject: "02", vatFactor: "EXENTO" },
    { quantity: "2", unitPrice: "50", taxObject: "01", vatRate: "0.16" },
  ]);
  const s = serializeInvoiceTotals(t);
  assert.deepEqual(
    [s.subtotal, s.discount, s.transferredTaxes, s.withheldTaxes, s.total],
    ["1200.30", "100.00", "160.00", "206.67", "1053.63"],
  );
  assert.deepEqual(s.lines[0], {
    subtotal: "1100.00",
    discount: "100.00",
    transferredTaxes: "160.00",
    withheldTaxes: "206.67",
    total: "953.33",
  });
  assert.equal(s.lines[1].total, "0.30");
  assert.equal(s.lines[2].transferredTaxes, "0.00");
  assert.equal(t.withheldVat.toFixed(2), "106.67");
  const legacy = invoiceTotals([
    { quantity: "2.5", unitPrice: "12.34", taxRate: "0.16" },
    { quantity: "3", unitPrice: "0.10", taxRate: "0.16" },
  ]);
  assert.deepEqual(
    [
      legacy.subtotal.toFixed(2),
      legacy.tax.toFixed(2),
      legacy.total.toFixed(2),
    ],
    ["31.15", "4.99", "36.14"],
  );
});

const concept = {
  description: "Servicio",
  productCode: "81112200",
  unitCode: "E48",
  quantity: "2",
  unitPrice: "500.00",
  taxObject: "02",
  vatFactor: "TASA",
  vatRate: "0.16",
};
const request = {
  clientId: "client-1",
  invoiceDate: "2026-10-07",
  documentType: "I",
  currency: "MXN",
  cfdiUse: "G03",
  paymentMethod: "PUE",
  paymentForm: "03",
  exportCode: "01",
  concepts: [concept],
};

test("draft structure follows the contract, keeps Phase 3 payloads working and ignores browser authority", () => {
  const legacy = draftSchema.parse({
    ...request,
    exportCode: undefined,
    organizationId: "other-tenant",
    status: "ISSUED",
    total: "999",
    concepts: [
      {
        ...concept,
        taxObject: undefined,
        vatFactor: undefined,
        vatRate: undefined,
        taxRate: "0.08",
      },
    ],
  });
  assert.equal(legacy.exportCode, "01");
  assert.deepEqual(
    [
      legacy.concepts[0].taxObject,
      legacy.concepts[0].vatFactor,
      legacy.concepts[0].vatRate,
    ],
    ["02", "TASA", "0.08"],
  );
  assert(
    !("organizationId" in legacy) &&
      !("status" in legacy) &&
      !("total" in legacy),
  );
  const blank = draftSchema.parse({
    ...request,
    paymentMethod: "",
    paymentForm: null,
    exchangeRate: "",
  });
  assert.equal(blank.paymentMethod, undefined);
  assert.equal(blank.exchangeRate, undefined);
  for (const bad of [
    { cfdiUse: "Gastos generales" },
    { currency: "XXX" },
    { paymentForm: "07" },
    { documentType: "P" },
    { concepts: [] },
    { concepts: [{ ...concept, quantity: "0" }] },
    { concepts: [{ ...concept, unitPrice: "1.001" }] },
    { concepts: [{ ...concept, taxObject: "09" }] },
    { concepts: [{ ...concept, vatFactor: "CUOTA" }] },
    { concepts: [{ ...concept, withholdingIsrRate: "10" }] },
  ])
    assert.equal(
      draftSchema.safeParse({ ...request, ...bad }).success,
      false,
      JSON.stringify(bad),
    );
  assert.equal(updateDraftSchema.safeParse(request).success, false);
  assert.equal(
    updateDraftSchema.safeParse({
      ...request,
      expectedUpdatedAt: "2026-10-07T12:00:00.000Z",
    }).success,
    true,
  );
  const structural = draftSchema.safeParse({
    ...request,
    paymentForm: "07",
    concepts: [concept, { ...concept, unitPrice: "abc" }],
  });
  assert(!structural.success);
  const issues = issuesFromStructure(structural.error.issues);
  assert(
    issues.some((i) => i.section === "payment" && i.field === "paymentForm"),
  );
  assert(
    issues.some(
      (i) =>
        i.section === "concepts" &&
        i.conceptIndex === 1 &&
        i.field === "unitPrice",
    ),
  );
  assert(issues.every((i) => i.severity === "ERROR" && i.message));
});

test("saved concepts are consistent templates; EXENTO is a factor, never a vatRate value", () => {
  const base = { ...concept, name: "Soporte mensual" };
  assert.equal(savedConceptSchema.safeParse(base).success, true);
  assert.equal(
    savedConceptSchema.safeParse({ ...base, vatRate: "EXENTO" }).success,
    false,
  );
  assert.equal(
    savedConceptSchema.safeParse({
      ...base,
      vatFactor: "EXENTO",
      vatRate: undefined,
    }).success,
    true,
  );
  assert.equal(
    savedConceptSchema.safeParse({ ...base, vatFactor: "EXENTO" }).success,
    false,
  );
  assert.equal(
    savedConceptSchema.safeParse({ ...base, taxObject: "01" }).success,
    false,
  );
  assert.equal(
    savedConceptSchema.safeParse({ ...base, vatRate: "0.15" }).success,
    false,
  );
  assert.equal(
    savedConceptSchema.safeParse({ ...base, taxObject: "05" }).success,
    false,
  );
});

const issuer = {
  rfc: "AAA010101AAA",
  legalName: "Emisor SA de CV",
  personType: "COMPANY",
  fiscalRegime: "601",
  postalCode: "06000",
  country: "MEX",
  profileComplete: true,
};
const receiver = {
  rfc: "BBB010101BBB",
  legalName: "Cliente SA de CV",
  personType: "COMPANY",
  fiscalRegime: "601",
  postalCode: "64000",
  country: "MEX",
};
function rules(
  draft: Record<string, unknown> = {},
  extra: Partial<InvoiceRuleInput> = {},
) {
  const parsed: InvoiceDraftInput = draftSchema.parse({ ...request, ...draft });
  return validateInvoice({
    issuer,
    receiver,
    draft: parsed,
    totals: calculateInvoiceTotals(parsed.concepts),
    ...extra,
  });
}
const codes = (r: ReturnType<typeof rules>) => r.issues.map((i) => i.code);

test("a complete Ingreso draft is valid and can become READY", () => {
  const r = rules();
  assert.deepEqual(r.issues, []);
  assert.equal(r.valid, true);
  assert.equal(r.canMarkReady, true);
  assert.deepEqual(new Set(Object.values(r.sections)), new Set(["OK"]));
});

test("payment method and form combinations are enforced server-side", () => {
  assert.deepEqual(codes(rules({ paymentMethod: "PPD", paymentForm: "03" })), [
    "PAYMENT_PPD_REQUIRES_99",
  ]);
  assert.deepEqual(codes(rules({ paymentMethod: "PUE", paymentForm: "99" })), [
    "PAYMENT_PUE_FORM_UNDEFINED",
  ]);
  assert.equal(rules({ paymentMethod: "PPD", paymentForm: "99" }).valid, true);
  const missing = rules({ paymentMethod: undefined, paymentForm: undefined });
  assert.deepEqual(codes(missing), [
    "PAYMENT_METHOD_REQUIRED",
    "PAYMENT_FORM_REQUIRED",
  ]);
  assert.equal(missing.sections.payment, "ERROR");
  assert.equal(missing.issues[0].field, "paymentMethod");
});

test("CFDI use must match receiver person type, regime and supported complements", () => {
  assert(
    codes(rules({ cfdiUse: "D01" })).includes("CFDI_USE_PERSON_TYPE_MISMATCH"),
  );
  assert(
    codes(
      rules(
        {},
        {
          receiver: {
            ...receiver,
            rfc: "BBBB010101BB1",
            personType: "INDIVIDUAL",
            fiscalRegime: "605",
          },
        },
      ),
    ).includes("CFDI_USE_REGIME_MISMATCH"),
  );
  assert(codes(rules({ cfdiUse: "CP01" })).includes("CFDI_USE_NOT_SUPPORTED"));
  assert.equal(
    rules(
      { cfdiUse: "D01" },
      {
        receiver: {
          ...receiver,
          rfc: "BBBB010101BB1",
          personType: "INDIVIDUAL",
          fiscalRegime: "612",
        },
      },
    ).valid,
    true,
  );
});

test("only Ingreso can be ready; unsupported document, currency and export combinations are explicit", () => {
  const egreso = rules({ documentType: "E" });
  assert.equal(egreso.canMarkReady, false);
  assert(codes(egreso).includes("DOCUMENT_TYPE_NOT_SUPPORTED"));
  assert(
    codes(rules({ documentType: "T" })).includes(
      "PAYMENT_NOT_ALLOWED_FOR_TRANSFER",
    ),
  );
  assert.deepEqual(codes(rules({ currency: "USD" })), [
    "EXCHANGE_RATE_REQUIRED",
  ]);
  assert.equal(rules({ currency: "USD", exchangeRate: "17.2512" }).valid, true);
  assert.deepEqual(codes(rules({ exchangeRate: "17" })), [
    "EXCHANGE_RATE_NOT_ALLOWED",
  ]);
  assert.deepEqual(codes(rules({ currency: "EUR", exchangeRate: "0" })), [
    "EXCHANGE_RATE_INVALID",
  ]);
  assert.deepEqual(codes(rules({ exportCode: "02" })), [
    "EXPORT_CODE_NOT_SUPPORTED",
  ]);
});

test("concept tax object, VAT factor, rates, withholdings and discounts are validated per line", () => {
  const line = (c: Record<string, unknown>) =>
    rules({ concepts: [concept, { ...concept, ...c }] });
  const exempt = line({ vatFactor: "EXENTO" });
  assert.deepEqual(codes(exempt), ["CONCEPT_VAT_RATE_NOT_ALLOWED_FOR_EXEMPT"]);
  assert.equal(exempt.issues[0].conceptIndex, 1);
  assert.equal(exempt.issues[0].field, "vatRate");
  assert.equal(line({ vatFactor: "EXENTO", vatRate: undefined }).valid, true);
  assert.deepEqual(codes(line({ vatRate: undefined })), [
    "CONCEPT_VAT_RATE_REQUIRED",
  ]);
  assert.deepEqual(codes(line({ vatRate: "0.5" })), [
    "CONCEPT_VAT_RATE_INVALID",
  ]);
  assert.equal(line({ vatRate: "0.160000" }).valid, true);
  const border = line({ vatRate: "0.08" });
  assert.equal(border.valid, true);
  assert.equal(border.sections.concepts, "WARNING");
  assert.deepEqual(codes(line({ taxObject: "01" })), [
    "CONCEPT_TAX_OBJECT_FORBIDS_TAXES",
  ]);
  assert.equal(line({ taxObject: "01", vatRate: undefined }).valid, true);
  assert.deepEqual(codes(line({ taxObject: "05" })), [
    "CONCEPT_TAX_OBJECT_NOT_SUPPORTED",
  ]);
  assert.deepEqual(codes(line({ withholdingVatRate: "0.2" })), [
    "CONCEPT_WITHHOLDING_VAT_RATE_INVALID",
  ]);
  assert.deepEqual(
    codes(line({ vatRate: "0", withholdingVatRate: "0.106667" })),
    ["CONCEPT_WITHHOLDING_VAT_EXCEEDS_VAT"],
  );
  assert.deepEqual(codes(line({ withholdingIsrRate: "0.4" })), [
    "CONCEPT_WITHHOLDING_ISR_RATE_INVALID",
  ]);
  assert.equal(
    line({ withholdingVatRate: "0.106667", withholdingIsrRate: "0.1" }).valid,
    true,
  );
  assert.deepEqual(codes(line({ unitPrice: "0" })), [
    "CONCEPT_UNIT_PRICE_REQUIRED",
  ]);
  const discount = rules({ concepts: [{ ...concept, discount: "1500" }] });
  assert.deepEqual(codes(discount), [
    "CONCEPT_DISCOUNT_EXCEEDS_SUBTOTAL",
    "TOTAL_NEGATIVE",
  ]);
  assert.equal(discount.sections.totals, "ERROR");
});

test("generic RFCs, global invoices and foreign receivers follow CFDI 4.0 receiver rules", () => {
  const publico = {
    ...receiver,
    rfc: "XAXX010101000",
    personType: "INDIVIDUAL",
    legalName: "Juan Pérez",
  };
  assert.deepEqual(codes(rules({}, { receiver: publico })).sort(), [
    "CFDI_USE_GENERIC_RECEIVER",
    "RECEIVER_GENERIC_POSTAL_CODE",
    "RECEIVER_GENERIC_REGIME",
  ]);
  const ok = { ...publico, fiscalRegime: "616", postalCode: issuer.postalCode };
  assert.equal(rules({ cfdiUse: "S01" }, { receiver: ok }).valid, true);
  assert.deepEqual(
    codes(
      rules(
        { cfdiUse: "S01" },
        { receiver: { ...ok, legalName: "Público en General" } },
      ),
    ),
    ["GLOBAL_INVOICE_NOT_SUPPORTED"],
  );
  assert(
    codes(
      rules(
        {
          cfdiUse: "S01",
          concepts: [{ ...concept, withholdingIsrRate: "0.1" }],
        },
        { receiver: ok },
      ),
    ).includes("CONCEPT_WITHHOLDING_GENERIC_RECEIVER"),
  );
  const foreign = { ...ok, rfc: "XEXX010101000", country: "MEX" };
  assert.deepEqual(codes(rules({ cfdiUse: "S01" }, { receiver: foreign })), [
    "RECEIVER_FOREIGN_TAX_ID_REQUIRED",
    "RECEIVER_FOREIGN_RESIDENCE_INVALID",
  ]);
  assert.equal(
    rules(
      { cfdiUse: "S01" },
      { receiver: { ...foreign, country: "USA", foreignTaxId: "123456789" } },
    ).valid,
    true,
  );
});

test("issuer and receiver data produce clear messages; warnings never invalidate", () => {
  const incomplete = rules(
    {},
    { issuer: { ...issuer, profileComplete: false } },
  );
  assert.deepEqual(codes(incomplete), ["ISSUER_PROFILE_INCOMPLETE"]);
  assert.equal(incomplete.sections.issuer, "ERROR");
  assert.deepEqual(codes(rules({}, { issuer: null })), [
    "ISSUER_PROFILE_MISSING",
  ]);
  assert(
    codes(rules({}, { issuer: { ...issuer, fiscalRegime: "612" } })).includes(
      "ISSUER_REGIME_PERSON_TYPE_MISMATCH",
    ),
  );
  assert(
    codes(rules({}, { issuer: { ...issuer, fiscalRegime: "999" } })).includes(
      "ISSUER_REGIME_INVALID",
    ),
  );
  const postal = rules({}, { receiver: { ...receiver, postalCode: "" } });
  assert.equal(postal.issues[0].code, "RECEIVER_POSTAL_CODE_REQUIRED");
  assert.equal(
    postal.issues[0].message,
    "El receptor necesita un código postal fiscal.",
  );
  assert.deepEqual(codes(rules({}, { receiver: null })), ["RECEIVER_REQUIRED"]);
  assert.deepEqual(
    codes(rules({}, { receiver: { ...receiver, available: false } })),
    ["RECEIVER_NOT_AVAILABLE"],
  );
  assert(
    codes(
      rules({}, { receiver: { ...receiver, rfc: "BBB010101BB" } }),
    ).includes("RECEIVER_RFC_INVALID"),
  );
  assert.deepEqual(
    codes(rules({ concepts: [{ ...concept, productCode: "01010101" }] })),
    ["CONCEPT_PRODUCT_CODE_GENERIC"],
  );
  assert.deepEqual(
    codes(rules({ invoiceDate: "2026-10-09" }, { today: "2026-10-07" })),
    ["INVOICE_DATE_IN_FUTURE"],
  );
  assert.deepEqual(
    codes(rules({ invoiceDate: "2026-10-01" }, { today: "2026-10-07" })),
    ["INVOICE_DATE_OUTSIDE_STAMPING_WINDOW"],
  );
  assert.deepEqual(
    codes(
      rules(
        { concepts: [{ ...concept, savedConceptId: "c1" }] },
        { inactiveSavedConceptIds: new Set(["c1"]) },
      ),
    ),
    ["SAVED_CONCEPT_INACTIVE"],
  );
});

test("product and unit codes outside the verified catalog block READY but never block saving", () => {
  const verified = {
    isKnownProductCode: largeCatalogSources["product-services"].has,
    isKnownUnitCode: largeCatalogSources.units.has,
  };
  const known = rules({}, verified);
  assert.deepEqual(known.issues, []);
  assert.equal(known.canMarkReady, true);
  const product = rules(
    { concepts: [concept, { ...concept, productCode: "12345678" }] },
    verified,
  );
  assert.deepEqual(
    product.issues.map((i) => [i.code, i.severity, i.conceptIndex, i.field]),
    [["CONCEPT_PRODUCT_CODE_UNVERIFIED", "ERROR", 1, "productCode"]],
  );
  assert.match(
    product.issues[0].message,
    /aún no pudo verificarse contra el catálogo disponible/,
  );
  assert.deepEqual(
    [product.valid, product.canMarkReady, product.sections.concepts],
    [false, false, "ERROR"],
  );
  const unit = rules({ concepts: [{ ...concept, unitCode: "ZZZ" }] }, verified);
  assert.deepEqual(
    unit.issues.map((i) => [i.code, i.severity, i.field]),
    [["CONCEPT_UNIT_CODE_UNVERIFIED", "ERROR", "unitCode"]],
  );
  assert.equal(unit.canMarkReady, false);
  // The generic code is in the loaded catalog: it stays a non-blocking warning.
  const generic = rules(
    { concepts: [{ ...concept, productCode: "01010101" }] },
    verified,
  );
  assert.deepEqual(
    generic.issues.map((i) => [i.code, i.severity]),
    [["CONCEPT_PRODUCT_CODE_GENERIC", "WARNING"]],
  );
  assert.equal(generic.canMarkReady, true);
  // Structurally the draft is still saveable: only the format is a structural rule.
  assert.equal(
    draftSchema.safeParse({
      ...request,
      concepts: [{ ...concept, productCode: "12345678", unitCode: "ZZZ" }],
    }).success,
    true,
  );
  assert.equal(largeCatalogSources["product-services"].complete, false);
  assert.equal(largeCatalogSources.units.complete, false);
});

test("phase 5 migration is additive, backfills legacy lines and keeps saved concepts tenant-scoped", async () => {
  const db = await PGlite.create();
  try {
    // Explicit, stable baseline: exactly the migrations that preceded Fase 5A.
    // New migrations never change the set this test applies.
    const before5A = [
      "202609200001_phase1",
      "202609200002_multitenant",
      "202609270001_phase3",
      "202609300001_ticket_intelligence",
      "202610010001_ticket_billing",
    ];
    const phase5 = "202610070001_phase5_fiscal_foundation";
    const available = new Set(await readdir("prisma/migrations"));
    for (const name of [...before5A, phase5])
      assert(available.has(name), name + " migration is missing");
    for (const name of before5A)
      await db.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
    await db.exec(`INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('u','Existing','existing@example.test',NOW());
      INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('a','A',NOW()),('b','B',NOW());
      INSERT INTO "InvoiceSettings" ("organizationId","updatedAt") VALUES ('a',NOW());
      INSERT INTO "StampedInvoice" (id,"organizationId","userId","issuerRfc","receiverRfc",subtotal,tax,total,"updatedAt") VALUES ('legacy','a','u','AAA010101AAA','BBB010101BBB',31.15,4.99,36.14,NOW());
      INSERT INTO "StampedInvoiceConcept" (id,"stampedInvoiceId",description,quantity,"unitPrice","taxRate",total) VALUES ('c1','legacy','Uno',2.5,12.34,0.16,35.79),('c2','legacy','Dos',3,0.10,0.16,0.35);`);
    const migration = await readFile(
      `prisma/migrations/${phase5}/migration.sql`,
      "utf8",
    );
    assert(
      !/\b(DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|ALTER\s+COLUMN/i.test(migration),
    );
    await db.exec(migration);
    const lines = (
      await db.query<Record<string, string | number>>(
        `SELECT id, position, subtotal::text, "transferredTaxes"::text, "vatRate"::text, "taxObject", "vatFactor", total::text FROM "StampedInvoiceConcept" ORDER BY id`,
      )
    ).rows;
    assert.deepEqual(lines, [
      {
        id: "c1",
        position: 0,
        subtotal: "30.85",
        transferredTaxes: "4.94",
        vatRate: "0.160000",
        taxObject: "02",
        vatFactor: "TASA",
        total: "35.79",
      },
      {
        id: "c2",
        position: 1,
        subtotal: "0.30",
        transferredTaxes: "0.05",
        vatRate: "0.160000",
        taxObject: "02",
        vatFactor: "TASA",
        total: "0.35",
      },
    ]);
    const invoice = (
      await db.query<Record<string, string>>(
        `SELECT total::text, discount::text, "exportCode", status::text FROM "StampedInvoice" WHERE id='legacy'`,
      )
    ).rows[0];
    assert.deepEqual(invoice, {
      total: "36.14",
      discount: "0.00",
      exportCode: "01",
      status: "DRAFT",
    });
    const settings = (
      await db.query<Record<string, string | null>>(
        `SELECT "currencyDefault", "paymentMethodDefault", "paymentFormDefault" FROM "InvoiceSettings"`,
      )
    ).rows[0];
    assert.deepEqual(settings, {
      currencyDefault: "MXN",
      paymentMethodDefault: null,
      paymentFormDefault: null,
    });
    await db.exec(
      `INSERT INTO "SavedInvoiceConcept" (id,"organizationId","createdById",name,description,"productCode","unitCode","updatedAt") VALUES ('s1','a','u','Soporte','Soporte','81112200','E48',NOW())`,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "SavedInvoiceConcept" (id,"organizationId","createdById",name,description,"productCode","unitCode","updatedAt") VALUES ('s2','missing','u','X','X','81112200','E48',NOW())`,
      ),
    );
    await db.exec(`UPDATE "StampedInvoice" SET "idempotencyKey"='retry-key-1' WHERE id='legacy';
      INSERT INTO "StampedInvoice" (id,"organizationId","userId","issuerRfc","receiverRfc",subtotal,tax,total,"updatedAt","idempotencyKey") VALUES ('other-tenant','b','u','AAA010101AAA','BBB010101BBB',1,0,1,NOW(),'retry-key-1')`);
    await assert.rejects(
      db.exec(
        `INSERT INTO "StampedInvoice" (id,"organizationId","userId","issuerRfc","receiverRfc",subtotal,tax,total,"updatedAt","idempotencyKey") VALUES ('dup','a','u','AAA010101AAA','BBB010101BBB',1,0,1,NOW(),'retry-key-1')`,
      ),
    );
  } finally {
    await db.close();
  }
});
