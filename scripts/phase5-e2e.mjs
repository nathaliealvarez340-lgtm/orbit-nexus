import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { startDatabase } from "./local-database.mjs";

// Fase 5A backend E2E. All SQL targets ephemeral PGlite; requires `npm run build`.
const database = await startDatabase(),
  port = 3197,
  baseURL = `http://localhost:${port}`;
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL: "",
      DATABASE_URL: database.url,
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      MAIL_API_URL: "",
      MAIL_API_TOKEN: "",
      OCR_API_URL: "",
      OCR_API_TOKEN: "",
    },
  },
);
let logs = "";
app.stdout.on("data", (b) => (logs += b));
app.stderr.on("data", (b) => (logs += b));
const checks = [],
  contexts = [],
  origin = { Origin: baseURL };
const pass = (label) => {
  checks.push(label);
  console.log("PASS " + label);
};
const sql = async (query, params = []) =>
  (await database.db.query(query, params)).rows;
async function json(response, status = 200) {
  assert.equal(
    response.status(),
    status,
    `Expected ${status}: ${await response.text()}`,
  );
  return response.json();
}
const post = (ctx, path, data, headers = {}) =>
  ctx.post(path, { headers: { ...origin, ...headers }, data });
const patch = (ctx, path, data) => ctx.patch(path, { headers: origin, data });
async function api() {
  const ctx = await request.newContext({ baseURL });
  contexts.push(ctx);
  return ctx;
}
const credential = () =>
  "Synthetic-" + randomBytes(18).toString("hex") + "-9aZ";
async function account(name) {
  const ctx = await api();
  const user = (
    await json(
      await post(ctx, "/api/auth/sign-up/email", {
        name,
        email: `${name.toLowerCase()}@example.test`,
        password: credential(),
      }),
    )
  ).user;
  const org = await json(
    await post(ctx, "/api/organizations", { name: "Empresa " + name }),
    201,
  );
  return { ctx, user, org };
}
const upload = (ctx, kind, name, mimeType, buffer) =>
  ctx.post("/api/private-assets", {
    headers: origin,
    multipart: { kind, file: { name, mimeType, buffer } },
  });
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Mexico_City",
});
const codes = (validation) => validation.issues.map((i) => i.code);

await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/phase5-e2e-summary.json",
  JSON.stringify({ passed: false }),
);
try {
  const deadline = Date.now() + 45000;
  while (true) {
    try {
      if (
        (await fetch(baseURL + "/login", { signal: AbortSignal.timeout(3000) }))
          .ok
      )
        break;
    } catch {}
    if (Date.now() > deadline)
      throw new Error("Local test server did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
  const a = await account("PhaseFiveA"),
    b = await account("PhaseFiveB"),
    anon = await api();

  // --- Authentication and plan gating -------------------------------------------------
  for (const [method, path] of [
    ["get", "/api/outgoing-invoices/context"],
    ["get", "/api/invoice-concepts"],
    ["get", "/api/fiscal-catalogs/units?q=hora"],
    ["get", "/api/outgoing-invoices/missing"],
  ])
    await json(await anon[method](path), 401);
  await json(await post(anon, "/api/outgoing-invoices/validate", {}), 401);
  await json(await post(anon, "/api/invoice-concepts", {}), 401);
  await json(await a.ctx.get("/api/outgoing-invoices/context"), 403);
  await json(await a.ctx.get("/api/fiscal-catalogs/units?q=hora"), 403);
  await json(await post(a.ctx, "/api/outgoing-invoices/validate", {}), 403);
  await sql(
    `INSERT INTO "Subscription" ("organizationId",plan,"updatedAt") VALUES ($1,'PRO',NOW()),($2,'MAX',NOW())`,
    [a.org.id, b.org.id],
  );
  pass("new Invoice Studio APIs require a session and a PRO/MAX plan");

  // --- Tenant setup: complete issuer for A, incomplete issuer for B ------------------
  const clientData = {
    rfc: "BBB010101BBB",
    legalName: "Cliente Fase Cinco",
    personType: "COMPANY",
    fiscalRegime: "601",
    cfdiUse: "G03",
    email: "client@example.test",
    postalCode: "64000",
    defaultPaymentForm: "03",
    street: "Prueba",
    exteriorNumber: "1",
    colony: "Centro",
    locality: "Ciudad",
    municipality: "Municipio",
    state: "Estado",
    country: "MEX",
  };
  const client = await json(await post(a.ctx, "/api/clients", clientData), 201);
  const clientB = await json(
    await post(b.ctx, "/api/clients", { ...clientData, rfc: "CCC010101CCC" }),
    201,
  );
  const fiscal = {
    ...clientData,
    rfc: "AAA010101AAA",
    legalName: "Emisor Fase Cinco",
    postalCode: "06000",
    email: "fiscal@example.test",
    confirmed: true,
  };
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage().drawText("SYNTHETIC CSF FOR LOCAL TEST ONLY");
  const csf = await json(
    await upload(
      a.ctx,
      "CSF",
      "csf.pdf",
      "application/pdf",
      Buffer.from(await pdfDoc.save()),
    ),
    201,
  );
  await json(
    await post(a.ctx, "/api/fiscal-profile", {
      ...fiscal,
      csfDocumentId: csf.id,
    }),
  );
  await json(
    await post(b.ctx, "/api/fiscal-profile", {
      ...fiscal,
      rfc: "DDD010101DDD",
    }),
  );
  const logoPng = await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  for (const t of [a, b]) {
    const logo = await json(
      await upload(t.ctx, "INVOICE_LOGO", "logo.png", "image/png", logoPng),
      201,
    );
    t.logo = logo.id;
    await json(
      await post(t.ctx, "/api/outgoing-invoices/settings", {
        prefix: "ORB",
        color: "#3b82f6",
        template: "CLASSIC",
        logoDocumentId: logo.id,
      }),
    );
  }

  // --- Context DTO and settings defaults ---------------------------------------------
  const context = await json(await a.ctx.get("/api/outgoing-invoices/context"));
  assert.deepEqual(Object.keys(context.issuer).sort(), [
    "email",
    "fiscalRegime",
    "legalName",
    "organizationId",
    "postalCode",
    "profileComplete",
    "rfc",
  ]);
  assert.equal(context.issuer.organizationId, a.org.id);
  assert.equal(context.issuer.profileComplete, true);
  assert.deepEqual(
    [
      context.settings.prefix,
      context.settings.nextNumberPreview,
      context.settings.currencyDefault,
      context.settings.paymentMethodDefault,
      context.settings.paymentFormDefault,
      context.settings.logoAvailable,
    ],
    ["ORB", 1, "MXN", "PUE", undefined, true],
  );
  assert.equal(context.clients.length, 1);
  assert(
    !("organizationId" in context.clients[0]) &&
      !("notes" in context.clients[0]),
  );
  assert.deepEqual(Object.keys(context.catalogs).sort(), [
    "cfdiUses",
    "currencies",
    "documentTypes",
    "exportCodes",
    "fiscalRegimes",
    "paymentForms",
    "paymentMethods",
    "taxObjects",
  ]);
  assert.deepEqual(
    context.catalogs.documentTypes.find((o) => o.code === "E"),
    { code: "E", label: "Egreso", active: false },
  );
  await json(
    await post(a.ctx, "/api/outgoing-invoices/settings", {
      prefix: "ORB",
      color: "#3b82f6",
      template: "CLASSIC",
      logoDocumentId: a.logo,
      paymentFormDefault: "07",
    }),
    400,
  );
  await json(
    await post(a.ctx, "/api/outgoing-invoices/settings", {
      prefix: "ORB",
      color: "#3b82f6",
      template: "CLASSIC",
      logoDocumentId: a.logo,
      paymentFormDefault: "03",
    }),
  );
  await json(
    await post(a.ctx, "/api/outgoing-invoices/settings", {
      prefix: "ORB",
      color: "#3b82f6",
      template: "CLASSIC",
      logoDocumentId: a.logo,
    }),
  );
  assert.equal(
    (await json(await a.ctx.get("/api/outgoing-invoices/context"))).settings
      .paymentFormDefault,
    "03",
  );
  pass(
    "context is a tenant DTO with shared catalogs; settings defaults are additive and never invented",
  );

  // --- Large catalogs -----------------------------------------------------------------
  const search = await json(
    await a.ctx.get(
      "/api/fiscal-catalogs/product-services?q=software&limit=500",
    ),
  );
  assert.equal(search.complete, false);
  assert.equal(search.source, "CURATED_SUBSET");
  assert(search.results.length > 0 && search.results.length <= 50);
  assert(search.results.some((o) => o.code === "81112200"));
  assert.equal(
    (await json(await a.ctx.get("/api/fiscal-catalogs/units?q=E48"))).results[0]
      .code,
    "E48",
  );
  await json(await a.ctx.get("/api/fiscal-catalogs/cfdi-xml"), 404);
  pass(
    "large SAT catalogs are searched server-side, bounded and declared as a curated subset",
  );

  // --- Saved concepts: tenant isolation and template consistency ---------------------
  const conceptBody = {
    name: "Soporte mensual",
    description: "Soporte de software mensual",
    productCode: "81112200",
    unitCode: "E48",
    defaultQuantity: "1",
    unitPrice: "1000.00",
    taxObject: "02",
    vatFactor: "TASA",
    vatRate: "0.16",
  };
  const saved = await json(
    await post(a.ctx, "/api/invoice-concepts", {
      ...conceptBody,
      organizationId: b.org.id,
    }),
    201,
  );
  assert.equal(
    (
      await sql(
        `SELECT "organizationId" FROM "SavedInvoiceConcept" WHERE id=$1`,
        [saved.id],
      )
    )[0].organizationId,
    a.org.id,
  );
  assert.deepEqual(
    { ...saved, id: undefined },
    { ...conceptBody, id: undefined, active: true },
  );
  const savedB = await json(
    await post(b.ctx, "/api/invoice-concepts", conceptBody),
    201,
  );
  assert.deepEqual(
    (await json(await b.ctx.get("/api/invoice-concepts"))).map((c) => c.id),
    [savedB.id],
  );
  await json(
    await patch(b.ctx, "/api/invoice-concepts/" + saved.id, conceptBody),
    404,
  );
  await json(
    await b.ctx.delete("/api/invoice-concepts/" + saved.id, {
      headers: origin,
    }),
    404,
  );
  await json(
    await post(a.ctx, "/api/invoice-concepts", {
      ...conceptBody,
      vatFactor: "EXENTO",
    }),
    400,
  );
  await json(
    await post(a.ctx, "/api/invoice-concepts", {
      ...conceptBody,
      vatRate: "EXENTO",
    }),
    400,
  );
  await json(
    await a.ctx.post("/api/invoice-concepts", {
      headers: { Origin: "https://foreign.example.test" },
      data: conceptBody,
    }),
    403,
  );
  assert.equal(
    (await json(await a.ctx.get("/api/invoice-concepts?q=soporte"))).length,
    1,
  );
  pass(
    "saved concepts are tenant-scoped templates; foreign tenants cannot read, edit or deactivate them",
  );

  // --- Validate without saving ---------------------------------------------------------
  const line = {
    savedConceptId: saved.id,
    description: "Soporte de software mensual",
    productCode: "81112200",
    unitCode: "E48",
    quantity: "1",
    unitPrice: "1000.00",
    discount: "100.00",
    taxObject: "02",
    vatFactor: "TASA",
    vatRate: "0.16",
    withholdingVatRate: "0.106667",
    withholdingIsrRate: "0.10",
  };
  const draft = {
    clientId: client.id,
    invoiceDate: today,
    documentType: "I",
    currency: "MXN",
    cfdiUse: "G03",
    paymentMethod: "PUE",
    paymentForm: "03",
    exportCode: "01",
    concepts: [
      line,
      {
        ...line,
        savedConceptId: undefined,
        description: "Licencia",
        quantity: "3",
        unitPrice: "0.10",
        discount: undefined,
        withholdingVatRate: undefined,
        withholdingIsrRate: undefined,
      },
    ],
  };
  const before = (
    await sql(`SELECT COUNT(*)::int AS n FROM "StampedInvoice"`)
  )[0].n;
  const valid = await json(
    await post(a.ctx, "/api/outgoing-invoices/validate", draft),
  );
  assert.deepEqual(valid.validation.issues, []);
  assert.equal(valid.validation.canMarkReady, true);
  assert.deepEqual(
    [
      valid.totals.subtotal,
      valid.totals.discount,
      valid.totals.transferredTaxes,
      valid.totals.withheldTaxes,
      valid.totals.total,
    ],
    ["1000.30", "100.00", "144.05", "186.00", "858.35"],
  );
  const ppd = await json(
    await post(a.ctx, "/api/outgoing-invoices/validate", {
      ...draft,
      paymentMethod: "PPD",
    }),
  );
  assert.deepEqual(codes(ppd.validation), ["PAYMENT_PPD_REQUIRES_99"]);
  assert.equal(ppd.validation.sections.payment, "ERROR");
  const structural = await json(
    await post(a.ctx, "/api/outgoing-invoices/validate", {
      ...draft,
      concepts: [{ ...line, unitPrice: "abc" }],
    }),
  );
  assert.equal(structural.totals, null);
  assert.deepEqual(
    structural.validation.issues.map((i) => [i.code, i.conceptIndex, i.field]),
    [["FIELD_INVALID", 0, "unitPrice"]],
  );
  const foreign = await json(
    await post(a.ctx, "/api/outgoing-invoices/validate", {
      ...draft,
      clientId: clientB.id,
      concepts: [{ ...line, savedConceptId: savedB.id }],
    }),
  );
  assert(codes(foreign.validation).includes("RECEIVER_REQUIRED"));
  assert(codes(foreign.validation).includes("SAVED_CONCEPT_NOT_AVAILABLE"));
  assert.equal(
    (await sql(`SELECT COUNT(*)::int AS n FROM "StampedInvoice"`))[0].n,
    before,
  );
  pass(
    "validate computes Decimal totals and structured issues without persisting or resolving foreign data",
  );

  // --- Drafts are saved with fiscal errors; browser authority is ignored -------------
  const withErrors = await json(
    await post(a.ctx, "/api/outgoing-invoices", {
      ...draft,
      paymentMethod: "PPD",
      status: "READY",
      total: "1",
      organizationId: b.org.id,
    }),
    201,
  );
  assert.deepEqual(
    [withErrors.folio, withErrors.status, withErrors.validation.valid],
    ["ORB-000001", "DRAFT", false],
  );
  assert.equal(withErrors.totals.total, "858.35");
  await json(
    await post(a.ctx, "/api/outgoing-invoices", {
      ...draft,
      clientId: clientB.id,
    }),
    404,
  );
  await json(
    await post(a.ctx, "/api/outgoing-invoices", {
      ...draft,
      concepts: [{ ...line, savedConceptId: savedB.id }],
    }),
    404,
  );
  const invalidBody = await json(
    await post(a.ctx, "/api/outgoing-invoices", {
      ...draft,
      cfdiUse: "texto libre",
    }),
    400,
  );
  assert.equal(invalidBody.code, "INVALID_REQUEST");
  assert(
    invalidBody.fields.cfdiUse &&
      invalidBody.validation.issues[0].field === "cfdiUse",
  );
  const incomplete = await json(
    await post(b.ctx, "/api/outgoing-invoices", {
      ...draft,
      clientId: clientB.id,
      concepts: [{ ...line, savedConceptId: savedB.id }],
    }),
    201,
  );
  assert.deepEqual(codes(incomplete.validation), ["ISSUER_PROFILE_INCOMPLETE"]);
  pass(
    "drafts with fiscal errors save as DRAFT; status, totals and organizationId from the browser are ignored",
  );

  // --- Unverified SAT codes block READY but the draft is saved ------------------------
  const unverified = await json(
    await post(a.ctx, "/api/outgoing-invoices", {
      ...draft,
      concepts: [
        { ...line, savedConceptId: undefined, productCode: "12345678" },
        { ...line, savedConceptId: undefined, unitCode: "ZZZ" },
      ],
    }),
    201,
  );
  assert.equal(unverified.status, "DRAFT");
  assert.deepEqual(
    unverified.validation.issues.map((i) => [
      i.code,
      i.severity,
      i.conceptIndex,
    ]),
    [
      ["CONCEPT_PRODUCT_CODE_UNVERIFIED", "ERROR", 0],
      ["CONCEPT_UNIT_CODE_UNVERIFIED", "ERROR", 1],
    ],
  );
  assert.equal(unverified.validation.canMarkReady, false);
  const unverifiedReady = await json(
    await post(a.ctx, `/api/outgoing-invoices/${unverified.id}/ready`, {}),
    422,
  );
  assert.equal(unverifiedReady.code, "NOT_READY");
  assert.equal(
    (
      await sql(`SELECT status::text FROM "StampedInvoice" WHERE id=$1`, [
        unverified.id,
      ])
    )[0].status,
    "DRAFT",
  );
  const unverifiedSearch = await json(
    await a.ctx.get("/api/fiscal-catalogs/product-services?q=12345678"),
  );
  assert.deepEqual(
    [unverifiedSearch.complete, unverifiedSearch.results.length],
    [false, 0],
  );
  pass(
    "unverified product/unit codes are blocking errors: saved as DRAFT, never READY",
  );

  // --- Idempotency ---------------------------------------------------------------------
  const key = "phase5-" + randomUUID();
  const [first, second] = await Promise.all([
    post(a.ctx, "/api/outgoing-invoices", draft, { "Idempotency-Key": key }),
    post(a.ctx, "/api/outgoing-invoices", draft, { "Idempotency-Key": key }),
  ]);
  const replays = [await first.json(), await second.json()];
  assert.deepEqual([first.status(), second.status()].sort(), [200, 201]);
  assert.equal(replays[0].id, replays[1].id);
  assert.equal(
    (
      await sql(
        `SELECT COUNT(*)::int AS n FROM "StampedInvoice" WHERE "idempotencyKey"=$1`,
        [key],
      )
    )[0].n,
    1,
  );
  await json(
    await post(a.ctx, "/api/outgoing-invoices", draft, {
      "Idempotency-Key": "short",
    }),
    400,
  );
  const sameKeyOtherTenant = await post(
    b.ctx,
    "/api/outgoing-invoices",
    {
      ...draft,
      clientId: clientB.id,
      concepts: [{ ...line, savedConceptId: savedB.id }],
    },
    { "Idempotency-Key": key },
  );
  assert.equal(sameKeyOtherTenant.status(), 201);
  pass("Idempotency-Key retries and races return one draft per tenant");

  // --- Detail, snapshots and saved-concept immutability ------------------------------
  const detail = await json(
    await a.ctx.get("/api/outgoing-invoices/" + withErrors.id),
  );
  assert.deepEqual(
    [detail.status, detail.uuid, detail.folio, detail.total],
    ["DRAFT", null, "ORB-000001", "858.35"],
  );
  assert.deepEqual(
    detail.concepts.map((c) => [
      c.position,
      c.description,
      c.unitPrice,
      c.vatFactor,
      c.vatRate,
    ]),
    [
      [0, "Soporte de software mensual", "1000.00", "TASA", "0.16"],
      [1, "Licencia", "0.10", "TASA", "0.16"],
    ],
  );
  assert.equal(detail.concepts[0].withholdingVatRate, "0.106667");
  assert.equal(detail.receiverSnapshot.legalName, "Cliente Fase Cinco");
  assert(
    !("csfDocumentId" in detail.issuerSnapshot) &&
      !("userId" in detail.issuerSnapshot),
  );
  await json(
    await patch(a.ctx, "/api/invoice-concepts/" + saved.id, {
      ...conceptBody,
      description: "Plantilla cambiada",
      unitPrice: "9999.00",
    }),
  );
  await json(
    await a.ctx.delete("/api/invoice-concepts/" + saved.id, {
      headers: origin,
    }),
  );
  const afterTemplate = await json(
    await a.ctx.get("/api/outgoing-invoices/" + withErrors.id),
  );
  assert.deepEqual(
    afterTemplate.concepts[0].description,
    "Soporte de software mensual",
  );
  assert.deepEqual(afterTemplate.concepts[0].unitPrice, "1000.00");
  assert(codes(afterTemplate.validation).includes("SAVED_CONCEPT_INACTIVE"));
  assert.equal(
    (await json(await a.ctx.get("/api/invoice-concepts"))).length,
    0,
  );
  assert.equal(
    (
      await json(await a.ctx.get("/api/invoice-concepts?includeInactive=true"))
    )[0].active,
    false,
  );
  await json(await b.ctx.get("/api/outgoing-invoices/" + withErrors.id), 404);
  pass(
    "detail returns ordered snapshot lines; editing or deactivating a saved concept never alters the invoice",
  );

  // --- READY, PATCH and concurrency ----------------------------------------------------
  const notReady = await json(
    await post(a.ctx, `/api/outgoing-invoices/${withErrors.id}/ready`, {}),
    422,
  );
  assert.equal(notReady.code, "NOT_READY");
  assert(codes(notReady.validation).includes("PAYMENT_PPD_REQUIRES_99"));
  assert.equal(
    (
      await sql(`SELECT status::text FROM "StampedInvoice" WHERE id=$1`, [
        withErrors.id,
      ])
    )[0].status,
    "DRAFT",
  );
  const sequence = (
    await sql(
      `SELECT "nextNumber" FROM "InvoiceSettings" WHERE "organizationId"=$1`,
      [a.org.id],
    )
  )[0].nextNumber;
  const fixPayload = {
    ...draft,
    paymentMethod: "PUE",
    expectedUpdatedAt: withErrors.updatedAt,
  };
  const [p1, p2] = await Promise.all([
    patch(a.ctx, "/api/outgoing-invoices/" + withErrors.id, fixPayload),
    patch(a.ctx, "/api/outgoing-invoices/" + withErrors.id, fixPayload),
  ]);
  assert.deepEqual([p1.status(), p2.status()].sort(), [200, 409]);
  const fixed = p1.status() === 200 ? await p1.json() : await p2.json();
  assert.equal(
    (p1.status() === 409 ? await p1.json() : await p2.json()).code,
    "DRAFT_CONFLICT",
  );
  assert.deepEqual(
    [fixed.folio, fixed.status, fixed.validation.canMarkReady],
    ["ORB-000001", "DRAFT", true],
  );
  assert.equal(
    (
      await sql(
        `SELECT "nextNumber" FROM "InvoiceSettings" WHERE "organizationId"=$1`,
        [a.org.id],
      )
    )[0].nextNumber,
    sequence,
  );
  await json(
    await patch(a.ctx, "/api/outgoing-invoices/" + withErrors.id, {
      ...fixPayload,
      expectedUpdatedAt: withErrors.updatedAt,
    }),
    409,
  );
  await json(
    await patch(a.ctx, "/api/outgoing-invoices/" + withErrors.id, draft),
    400,
  );
  await json(
    await patch(b.ctx, "/api/outgoing-invoices/" + withErrors.id, {
      ...fixPayload,
      expectedUpdatedAt: fixed.updatedAt,
    }),
    404,
  );
  await json(
    await post(b.ctx, `/api/outgoing-invoices/${withErrors.id}/ready`, {}),
    404,
  );
  await json(
    await post(a.ctx, `/api/outgoing-invoices/${withErrors.id}/ready`, {
      expectedUpdatedAt: withErrors.updatedAt,
    }),
    409,
  );
  const ready = await json(
    await post(a.ctx, `/api/outgoing-invoices/${withErrors.id}/ready`, {
      expectedUpdatedAt: fixed.updatedAt,
    }),
  );
  assert.deepEqual(
    [ready.status, ready.validation.canMarkReady],
    ["READY", true],
  );
  assert.equal(
    (
      await json(
        await post(a.ctx, `/api/outgoing-invoices/${withErrors.id}/ready`, {}),
      )
    ).status,
    "READY",
  );
  const readyRow = (
    await sql(
      `SELECT status::text, uuid, "readyAt", "issuedAt", "xmlDocumentId" FROM "StampedInvoice" WHERE id=$1`,
      [withErrors.id],
    )
  )[0];
  assert.deepEqual(
    [readyRow.status, readyRow.uuid, readyRow.issuedAt, readyRow.xmlDocumentId],
    ["READY", null, null, null],
  );
  assert(readyRow.readyAt);
  const reopened = await json(
    await patch(a.ctx, "/api/outgoing-invoices/" + withErrors.id, {
      ...draft,
      expectedUpdatedAt: ready.updatedAt,
    }),
  );
  assert.equal(reopened.status, "DRAFT");
  assert.equal(
    (
      await sql(`SELECT "readyAt" FROM "StampedInvoice" WHERE id=$1`, [
        withErrors.id,
      ])
    )[0].readyAt,
    null,
  );
  pass(
    "READY requires server-side validation; editing returns to DRAFT; stale or concurrent saves conflict without new folios",
  );

  // --- Only Ingreso can be READY; stale snapshots block READY -------------------------
  const egreso = await json(
    await post(a.ctx, "/api/outgoing-invoices", {
      ...draft,
      documentType: "E",
      cfdiUse: "G02",
    }),
    201,
  );
  assert.equal(egreso.status, "DRAFT");
  const egresoReady = await json(
    await post(a.ctx, `/api/outgoing-invoices/${egreso.id}/ready`, {}),
    422,
  );
  assert(codes(egresoReady.validation).includes("DOCUMENT_TYPE_NOT_SUPPORTED"));
  assert.equal(egresoReady.validation.canMarkReady, false);
  await json(
    await patch(a.ctx, "/api/clients/" + client.id, {
      ...clientData,
      legalName: "Cliente renombrado",
    }),
  );
  const stale = await json(
    await post(a.ctx, `/api/outgoing-invoices/${reopened.id}/ready`, {}),
    422,
  );
  assert.deepEqual(
    stale.validation.issues
      .filter((i) => i.severity === "ERROR")
      .map((i) => i.code),
    ["RECEIVER_SNAPSHOT_OUTDATED"],
  );
  const refreshed = await json(
    await patch(a.ctx, "/api/outgoing-invoices/" + reopened.id, {
      ...draft,
      expectedUpdatedAt: reopened.updatedAt,
    }),
  );
  assert.equal(
    (
      await json(
        await post(a.ctx, `/api/outgoing-invoices/${refreshed.id}/ready`, {}),
      )
    ).status,
    "READY",
  );
  assert.equal(
    (await json(await a.ctx.get("/api/outgoing-invoices/" + refreshed.id)))
      .receiverSnapshot.legalName,
    "Cliente renombrado",
  );
  pass(
    "Egreso never becomes READY; changed client data must be re-saved before READY",
  );

  // --- Payload limits ------------------------------------------------------------------
  const big = {
    ...draft,
    concepts: Array.from({ length: 100 }, (_, i) => ({
      ...line,
      savedConceptId: undefined,
      description: "Concepto " + i + " " + "x".repeat(900),
    })),
  };
  assert(Buffer.byteLength(JSON.stringify(big)) > 32768);
  const bigDraft = await json(
    await post(a.ctx, "/api/outgoing-invoices", big),
    201,
  );
  assert.equal(
    (
      await json(await a.ctx.get("/api/outgoing-invoices/" + bigDraft.id))
    ).concepts.at(-1).position,
    99,
  );
  await json(
    await a.ctx.post("/api/outgoing-invoices/validate", {
      headers: { ...origin, "Content-Type": "application/json" },
      data: JSON.stringify({ pad: "x".repeat(270 * 1024) }),
    }),
    413,
  );
  await json(
    await a.ctx.post("/api/invoice-concepts", {
      headers: { ...origin, "Content-Type": "application/json" },
      data: JSON.stringify({ ...conceptBody, pad: "x".repeat(40 * 1024) }),
    }),
    413,
  );
  pass(
    "Invoice Studio routes accept up to 256 KiB while other routes keep the global limit",
  );

  // --- Never issued, audit without fiscal payloads, issued list unchanged -------------
  assert.equal(
    (
      await sql(
        `SELECT COUNT(*)::int AS n FROM "StampedInvoice" WHERE status='ISSUED' OR uuid IS NOT NULL`,
      )
    )[0].n,
    0,
  );
  assert.deepEqual(await json(await a.ctx.get("/api/outgoing-invoices")), []);
  const actions = await sql(
    `SELECT action, metadata FROM "ActivityLog" WHERE "organizationId"=$1`,
    [a.org.id],
  );
  for (const action of [
    "INVOICE_DRAFT_CREATED",
    "INVOICE_DRAFT_UPDATED",
    "INVOICE_MARKED_READY",
    "INVOICE_CONCEPT_CREATED",
    "INVOICE_CONCEPT_UPDATED",
    "INVOICE_CONCEPT_DEACTIVATED",
  ])
    assert(
      actions.some((r) => r.action === action),
      action,
    );
  assert(
    actions
      .filter((r) => r.action.startsWith("INVOICE_"))
      .every((r) => r.metadata === null),
  );
  pass(
    "no invoice becomes ISSUED or gets a UUID; audit events carry no fiscal payloads",
  );

  await writeFile(
    "test-results/phase5-e2e-summary.json",
    JSON.stringify(
      { passed: true, checks, database: "ephemeral local PGlite; no Neon" },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile("test-results/phase5-server.log", logs);
  await writeFile(
    "test-results/phase5-e2e-summary.json",
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  for (const ctx of contexts) await ctx.dispose();
  app.kill();
  if (app.exitCode === null)
    await new Promise((resolve) => app.once("exit", resolve));
  await database.close();
}
