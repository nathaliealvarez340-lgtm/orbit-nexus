import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
import sharp from "sharp";
import { startDatabase } from "./local-database.mjs";
import { syntheticCsf } from "../tests/fixtures/synthetic-csf.mjs";

// Fase 5C-A Bloque 1 E2E (fiscal identity, consent, CSF extraction). Ephemeral PGlite
// only; requires `npm run build`. No Neon, no production, no real documents.
const database = await startDatabase(),
  port = 3196,
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
      VERCEL_ENV: "",
      PRIVACY_NOTICE_VERSION: "",
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
const post = (ctx, path, data) => ctx.post(path, { headers: origin, data });
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
const profileText =
  "Autorizo a ORBIT NEXUS a leer esta Constancia de Situación Fiscal con la finalidad de extraer y prellenar mis datos fiscales. Podré revisar y corregir la información antes de guardarla. Esta autorización no implica la emisión de CFDI ni autoriza el uso de mi e.firma.";

await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/phase5c-e2e-summary.json",
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
  const a = await account("FiveCA"),
    b = await account("FiveCB"),
    m = await account("FiveCMember"),
    anon = await api();
  await sql(
    `INSERT INTO "Membership" (id,"organizationId","userId",role) VALUES ('m-five-c',$1,$2,'MEMBER')`,
    [a.org.id, m.user.id],
  );
  await json(
    await post(m.ctx, "/api/organizations/active", {
      organizationId: a.org.id,
    }),
  );

  // --- Authentication -------------------------------------------------------------------
  for (const path of [
    "/api/fiscal-consents/terms?purpose=FISCAL_PROFILE_PREFILL",
    "/api/fiscal-extractions/missing",
    "/api/fiscal-catalogs/fiscal-regimes",
  ])
    await json(await anon.get(path), 401);
  await json(await post(anon, "/api/fiscal-consents", {}), 401);
  await json(await post(anon, "/api/fiscal-extractions", {}), 401);
  pass("fiscal identity APIs require a session");

  // --- Official catalogs (session only, no invoice plan) ----------------------------------
  const regimes = await json(
    await a.ctx.get("/api/fiscal-catalogs/fiscal-regimes?personType=COMPANY"),
  );
  assert.deepEqual(
    [regimes.source, regimes.complete, regimes.version],
    ["SAT_OFFICIAL", true, "catCFDI_V_4_20261001"],
  );
  assert(
    regimes.results.some(
      (o) => o.code === "601" && o.label === "General de Ley Personas Morales",
    ),
  );
  assert(!regimes.results.some((o) => o.code === "612"));
  const uses = (
    await json(
      await a.ctx.get(
        "/api/fiscal-catalogs/cfdi-uses?personType=INDIVIDUAL&regime=616",
      ),
    )
  ).results.map((o) => o.code);
  assert(uses.includes("S01") && uses.includes("G02") && !uses.includes("G03"));
  assert.equal(
    (
      await json(
        await a.ctx.get("/api/fiscal-catalogs/fiscal-regimes?q=simplificado"),
      )
    ).results[0].code,
    "626",
  );
  await json(
    await a.ctx.get("/api/fiscal-catalogs/product-services?q=software"),
    403,
  );
  pass(
    "official régimen/Uso CFDI catalogs are versioned, complete and filtered by compatibility",
  );

  // --- Terms, upload without extraction ------------------------------------------------
  const terms = await json(
    await a.ctx.get(
      "/api/fiscal-consents/terms?purpose=FISCAL_PROFILE_PREFILL",
    ),
  );
  assert.deepEqual(
    [terms.text, terms.privacyNoticeVersion],
    [profileText, null],
  );
  const clientTerms = await json(
    await a.ctx.get("/api/fiscal-consents/terms?purpose=CLIENT_FISCAL_PREFILL"),
  );
  assert.match(clientTerms.text, /^Declaro que cuento con facultades/);
  await json(await a.ctx.get("/api/fiscal-consents/terms?purpose=OTHER"), 400);
  const csfPdf = await syntheticCsf({
    rfc: "EKU9003173C9",
    companyName: "ESCUELA KEMPER URGATE",
  });
  const csf = await json(
    await upload(a.ctx, "CSF", "constancia.pdf", "application/pdf", csfPdf),
    201,
  );
  assert.equal(
    (await sql(`SELECT COUNT(*)::int AS n FROM "FiscalDocumentExtraction"`))[0]
      .n,
    0,
  );
  await json(
    await upload(m.ctx, "CSF", "constancia.pdf", "application/pdf", csfPdf),
    403,
  );
  pass("uploading a CSF stores it privately and never extracts it");

  // --- Consent ------------------------------------------------------------------------------
  const consentBody = {
    documentId: csf.id,
    purpose: "FISCAL_PROFILE_PREFILL",
    accepted: true,
    consentVersion: terms.consentVersion,
    privacyNoticeVersion: null,
  };
  const noConsent = await json(
    await post(a.ctx, "/api/fiscal-extractions", { consentId: "missing" }),
    404,
  );
  assert.equal(noConsent.code, "CONSENT_REQUIRED");
  assert.equal(
    (await json(await post(b.ctx, "/api/fiscal-consents", consentBody), 404))
      .code,
    "DOCUMENT_NOT_AVAILABLE",
  );
  await json(
    await post(a.ctx, "/api/fiscal-consents", {
      ...consentBody,
      accepted: false,
    }),
    400,
  );
  assert.equal(
    (
      await json(
        await post(a.ctx, "/api/fiscal-consents", {
          ...consentBody,
          consentVersion: "old",
        }),
        409,
      )
    ).code,
    "CONSENT_VERSION_OUTDATED",
  );
  assert.equal(
    (
      await json(
        await post(a.ctx, "/api/fiscal-consents", {
          ...consentBody,
          privacyNoticeVersion: "x",
        }),
        409,
      )
    ).code,
    "PRIVACY_NOTICE_OUTDATED",
  );
  await json(await post(m.ctx, "/api/fiscal-consents", consentBody), 403);
  await json(
    await a.ctx.post("/api/fiscal-consents", {
      headers: { Origin: "https://foreign.example.test" },
      data: consentBody,
    }),
    403,
  );
  const consent = await json(
    await post(a.ctx, "/api/fiscal-consents", {
      ...consentBody,
      organizationId: b.org.id,
      userId: b.user.id,
    }),
    201,
  );
  const stored = (
    await sql(
      `SELECT "organizationId","userId","consentVersion","privacyNoticeVersion" FROM "FiscalDocumentConsent" WHERE id=$1`,
      [consent.id],
    )
  )[0];
  assert.deepEqual(stored, {
    organizationId: a.org.id,
    userId: a.user.id,
    consentVersion: terms.consentVersion,
    privacyNoticeVersion: null,
  });
  assert(
    (
      await sql(
        `SELECT 1 FROM "ActivityLog" WHERE action='FISCAL_CONSENT_ACCEPTED' AND "entityId"=$1 AND metadata IS NULL`,
        [consent.id],
      )
    ).length,
  );
  pass(
    "consent is explicit, versioned, tenant-safe and derived from the session",
  );

  // --- Extraction --------------------------------------------------------------------------
  await json(
    await post(b.ctx, "/api/fiscal-extractions", { consentId: consent.id }),
    404,
  );
  await json(
    await post(m.ctx, "/api/fiscal-extractions", { consentId: consent.id }),
    404,
  );
  const extraction = await json(
    await post(a.ctx, "/api/fiscal-extractions", { consentId: consent.id }),
    201,
  );
  assert.deepEqual(
    [
      extraction.status,
      extraction.fields.rfc.value,
      extraction.fields.rfc.status,
      extraction.fields.postalCode.status,
      extraction.fields.legalName.status,
    ],
    ["PARTIAL", "EKU9003173C9", "DETECTED", "DETECTED", "LOW_CONFIDENCE"],
  );
  assert.deepEqual(
    extraction.regimes.map((r) => r.code),
    ["601"],
  );
  assert.deepEqual(extraction.comparison, []);
  assert.equal(
    extraction.message,
    "No pudimos identificar todos los datos de tu Constancia. Puedes revisarlos y completarlos manualmente.",
  );
  assert(!JSON.stringify(extraction).includes("contacto@example.test"));
  assert.equal(
    (
      await json(
        await post(a.ctx, "/api/fiscal-extractions", { consentId: consent.id }),
      )
    ).id,
    extraction.id,
  );
  assert.equal(
    (await json(await a.ctx.get("/api/fiscal-extractions/" + extraction.id)))
      .id,
    extraction.id,
  );
  await json(await b.ctx.get("/api/fiscal-extractions/" + extraction.id), 404);
  // Detected profile data is visible only to OWNER/ADMIN, who may confirm it.
  await json(await m.ctx.get("/api/fiscal-extractions/" + extraction.id), 403);
  pass(
    "extraction requires the user's consent, never infers contact data and is tenant-scoped",
  );

  // --- Confirmation with provenance, manual capture and catalog validation ----------------
  const confirmed = {
    rfc: extraction.fields.rfc.value,
    legalName: extraction.fields.legalName.value,
    personType: "COMPANY",
    fiscalRegime: "601",
    postalCode: extraction.fields.postalCode.value,
    cfdiUse: "G03",
    email: "fiscal@example.test",
    street: extraction.fields.street.value,
    exteriorNumber: extraction.fields.exteriorNumber.value,
    colony: extraction.fields.colony.value,
    locality: extraction.fields.locality.value,
    municipality: extraction.fields.municipality.value,
    state: extraction.fields.state.value,
    country: "MEX",
    confirmed: true,
    extractionId: extraction.id,
  };
  await json(
    await post(a.ctx, "/api/fiscal-profile", {
      ...confirmed,
      fiscalRegime: "999",
    }),
    400,
  );
  await json(
    await post(a.ctx, "/api/fiscal-profile", {
      ...confirmed,
      fiscalRegime: "612",
    }),
    400,
  );
  await json(
    await post(a.ctx, "/api/fiscal-profile", {
      ...confirmed,
      extractionId: "foreign",
    }),
    404,
  );
  await json(await post(a.ctx, "/api/fiscal-profile", confirmed));
  const profileRow = (
    await sql(
      `SELECT "sourceExtractionId","confirmedById","csfDocumentId","legalName" FROM "FiscalProfile" WHERE "organizationId"=$1`,
      [a.org.id],
    )
  )[0];
  assert.deepEqual(profileRow, {
    sourceExtractionId: extraction.id,
    confirmedById: a.user.id,
    csfDocumentId: csf.id,
    legalName: "ESCUELA KEMPER URGATE",
  });
  const generic = {
    rfc: "XAXX010101000",
    legalName: "Usuario de prueba",
    fiscalRegime: "616",
    postalCode: "06600",
    cfdiUse: "G03",
    email: "b@example.test",
    personType: "INDIVIDUAL",
    confirmed: true,
  };
  const genericError = await json(
    await post(b.ctx, "/api/fiscal-profile", generic),
    400,
  );
  assert.match(genericError.fields.cfdiUse[0], /S01/);
  await json(
    await post(b.ctx, "/api/fiscal-profile", { ...generic, cfdiUse: "S01" }),
  );
  pass(
    "confirmation records provenance; manual capture works; régimen/Uso CFDI are catalog-validated",
  );

  // --- New CSF never overwrites confirmed data ----------------------------------------
  const newer = await json(
    await upload(
      a.ctx,
      "CSF",
      "nueva.pdf",
      "application/pdf",
      await syntheticCsf({
        rfc: "EKU9003173C9",
        companyName: "ESCUELA KEMPER URGATE NUEVA",
      }),
    ),
    201,
  );
  const consent2 = await json(
    await post(a.ctx, "/api/fiscal-consents", {
      ...consentBody,
      documentId: newer.id,
    }),
    201,
  );
  const extraction2 = await json(
    await post(a.ctx, "/api/fiscal-extractions", { consentId: consent2.id }),
    201,
  );
  const nameChange = extraction2.comparison.find(
    (c) => c.field === "legalName",
  );
  assert.deepEqual(nameChange, {
    field: "legalName",
    current: "ESCUELA KEMPER URGATE",
    detected: "ESCUELA KEMPER URGATE NUEVA",
    changed: true,
  });
  assert.equal(
    extraction2.comparison.find((c) => c.field === "rfc").changed,
    false,
  );
  assert.equal(
    (
      await sql(
        `SELECT "legalName" FROM "FiscalProfile" WHERE "organizationId"=$1`,
        [a.org.id],
      )
    )[0].legalName,
    "ESCUELA KEMPER URGATE",
  );
  pass(
    "a new CSF is compared against confirmed data and never applied automatically",
  );

  // --- Client CSF (optional) ------------------------------------------------------------
  const clientData = {
    rfc: "IIA040805DZ4",
    legalName: "Cliente Fase C",
    personType: "COMPANY",
    fiscalRegime: "601",
    cfdiUse: "G03",
    email: "c@example.test",
    postalCode: "64000",
  };
  await json(
    await post(a.ctx, "/api/clients", { ...clientData, fiscalRegime: "605" }),
    400,
  );
  await json(
    await post(a.ctx, "/api/clients", { ...clientData, cfdiUse: "D01" }),
    400,
  );
  const client = await json(await post(a.ctx, "/api/clients", clientData), 201);
  const otherClient = await json(
    await post(a.ctx, "/api/clients", { ...clientData, rfc: "XIA190128J61" }),
    201,
  );
  const clientB = await json(
    await post(b.ctx, "/api/clients", clientData),
    201,
  );
  const clientCsf = await json(
    await upload(
      m.ctx,
      "CLIENT_CSF",
      "cliente.pdf",
      "application/pdf",
      await syntheticCsf({
        rfc: "IIA040805DZ4",
        companyName: "CLIENTE FASE C SA",
        postalCode: "64000",
      }),
    ),
    201,
  );
  const clientConsent = {
    documentId: clientCsf.id,
    purpose: "CLIENT_FISCAL_PREFILL",
    accepted: true,
    consentVersion: clientTerms.consentVersion,
    privacyNoticeVersion: null,
  };
  assert.equal(
    (await json(await post(m.ctx, "/api/fiscal-consents", clientConsent), 400))
      .code,
    "CLIENT_REQUIRED",
  );
  assert.equal(
    (
      await json(
        await post(m.ctx, "/api/fiscal-consents", {
          ...clientConsent,
          clientId: clientB.id,
        }),
        404,
      )
    ).code,
    "CLIENT_NOT_AVAILABLE",
  );
  assert.equal(
    (
      await json(
        await post(m.ctx, "/api/fiscal-consents", {
          ...clientConsent,
          documentId: csf.id,
          clientId: client.id,
        }),
        409,
      )
    ).code,
    "DOCUMENT_NOT_SUPPORTED",
  );
  const memberConsent = await json(
    await post(m.ctx, "/api/fiscal-consents", {
      ...clientConsent,
      clientId: client.id,
    }),
    201,
  );
  const clientExtraction = await json(
    await post(m.ctx, "/api/fiscal-extractions", {
      consentId: memberConsent.id,
    }),
    201,
  );
  assert.equal(clientExtraction.clientId, client.id);
  assert.equal(
    clientExtraction.comparison.find((c) => c.field === "legalName").changed,
    true,
  );
  // Members may edit clients, so they may also read this client's extraction.
  assert.equal(
    (
      await json(
        await m.ctx.get("/api/fiscal-extractions/" + clientExtraction.id),
      )
    ).id,
    clientExtraction.id,
  );
  // Once the client can no longer be edited (archived), its CSF is not processed.
  const archivedClient = await json(
    await post(a.ctx, "/api/clients", { ...clientData, rfc: "EWE1709045U0" }),
    201,
  );
  const archivedConsent = await json(
    await post(m.ctx, "/api/fiscal-consents", {
      ...clientConsent,
      clientId: archivedClient.id,
    }),
    201,
  );
  await json(
    await a.ctx.delete("/api/clients/" + archivedClient.id, {
      headers: origin,
    }),
  );
  assert.equal(
    (
      await json(
        await post(m.ctx, "/api/fiscal-extractions", {
          consentId: archivedConsent.id,
        }),
        404,
      )
    ).code,
    "CLIENT_NOT_AVAILABLE",
  );
  const reviewed = {
    ...clientData,
    legalName: clientExtraction.fields.legalName.value,
    extractionId: clientExtraction.id,
  };
  await json(await patch(a.ctx, "/api/clients/" + client.id, reviewed), 400);
  await json(
    await patch(a.ctx, "/api/clients/" + otherClient.id, {
      ...reviewed,
      confirmed: true,
    }),
    404,
  );
  await json(
    await post(a.ctx, "/api/clients", { ...reviewed, confirmed: true }),
    404,
  );
  await json(
    await patch(a.ctx, "/api/clients/" + client.id, {
      ...reviewed,
      confirmed: true,
    }),
  );
  const clientRow = (
    await sql(
      `SELECT "csfDocumentId","sourceExtractionId","confirmedById","legalName" FROM "Client" WHERE id=$1`,
      [client.id],
    )
  )[0];
  assert.deepEqual(clientRow, {
    csfDocumentId: clientCsf.id,
    sourceExtractionId: clientExtraction.id,
    confirmedById: a.user.id,
    legalName: "CLIENTE FASE C SA",
  });
  pass(
    "optional client CSF requires the declaration, stays tenant-scoped and is confirmed explicitly",
  );

  // --- Phase 3 XML upload no longer extracts --------------------------------------------
  const xml = `<c:Comprobante xmlns:c="http://www.sat.gob.mx/cfd/4" Version="4.0" Moneda="MXN" TipoDeComprobante="I" Fecha="2026-09-15T12:00:00" SubTotal="100" Total="116"><c:Emisor Rfc="EKU9003173C9" Nombre="Fixture"/><c:Receptor Rfc="XAXX010101000" Nombre="Receptor" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="616" UsoCFDI="S01"/></c:Comprobante>`;
  const fiscalXml = await json(
    await a.ctx.post("/api/fiscal-documents", {
      headers: origin,
      multipart: {
        file: {
          name: "fiscal.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(xml),
        },
      },
    }),
    201,
  );
  assert.deepEqual(
    (
      await sql(
        `SELECT "extractedData" FROM "UploadedFiscalDocument" WHERE id=$1`,
        [fiscalXml.id],
      )
    )[0].extractedData,
    {},
  );
  assert.equal(
    (
      await json(
        await post(a.ctx, "/api/fiscal-consents", {
          ...consentBody,
          documentId: fiscalXml.documentId,
        }),
        409,
      )
    ).code,
    "DOCUMENT_NOT_SUPPORTED",
  );
  await json(
    await a.ctx.post("/api/fiscal-documents", {
      headers: origin,
      multipart: {
        file: {
          name: "bad.xml",
          mimeType: "application/xml",
          buffer: Buffer.from("<x/>"),
        },
      },
    }),
    400,
  );
  pass("Phase 3 XML upload is stored without reading party data");

  // --- READY → DRAFT when master data changes -------------------------------------------
  await sql(
    `INSERT INTO "Subscription" ("organizationId",plan,"updatedAt") VALUES ($1,'PRO',NOW())`,
    [a.org.id],
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
  const logo = await json(
    await upload(a.ctx, "INVOICE_LOGO", "logo.png", "image/png", logoPng),
    201,
  );
  await json(
    await post(a.ctx, "/api/outgoing-invoices/settings", {
      prefix: "ORB",
      color: "#3b82f6",
      template: "CLASSIC",
      logoDocumentId: logo.id,
    }),
  );
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
      {
        description: "Soporte",
        productCode: "81112200",
        unitCode: "E48",
        quantity: "1",
        unitPrice: "100.00",
        taxObject: "02",
        vatFactor: "TASA",
        vatRate: "0.16",
      },
    ],
  };
  const status = async (id) =>
    (
      await sql(
        `SELECT status::text, version, "readyAt" FROM "StampedInvoice" WHERE id=$1`,
        [id],
      )
    )[0];
  const created = await json(
    await post(a.ctx, "/api/outgoing-invoices", draft),
    201,
  );
  assert.deepEqual(created.validation.issues, []);
  await json(
    await post(a.ctx, `/api/outgoing-invoices/${created.id}/ready`, {}),
  );
  assert.deepEqual(
    [(await status(created.id)).status, (await status(created.id)).version],
    ["READY", 1],
  );
  await json(
    await patch(a.ctx, "/api/clients/" + client.id, {
      ...clientData,
      legalName: "Cliente renombrado",
    }),
  );
  let row = await status(created.id);
  assert.deepEqual([row.status, row.version, row.readyAt], ["DRAFT", 2, null]);
  assert.equal(
    (await json(await a.ctx.get("/api/outgoing-invoices/" + created.id)))
      .version,
    2,
  );
  // Non-fiscal client edits do not invalidate READY.
  let detail = await json(
    await a.ctx.get("/api/outgoing-invoices/" + created.id),
  );
  const resaved = await json(
    await patch(a.ctx, "/api/outgoing-invoices/" + created.id, {
      ...draft,
      expectedUpdatedAt: detail.updatedAt,
    }),
  );
  await json(
    await post(a.ctx, `/api/outgoing-invoices/${resaved.id}/ready`, {}),
  );
  await json(
    await patch(a.ctx, "/api/clients/" + client.id, {
      ...clientData,
      legalName: "Cliente renombrado",
      email: "otro@example.test",
    }),
  );
  assert.equal((await status(created.id)).status, "READY");
  await json(
    await post(a.ctx, "/api/fiscal-profile", {
      ...confirmed,
      legalName: "ESCUELA KEMPER URGATE CAMBIO",
      extractionId: undefined,
    }),
  );
  row = await status(created.id);
  assert.deepEqual([row.status, row.version], ["DRAFT", 4]);
  detail = await json(await a.ctx.get("/api/outgoing-invoices/" + created.id));
  await json(
    await patch(a.ctx, "/api/outgoing-invoices/" + created.id, {
      ...draft,
      expectedUpdatedAt: detail.updatedAt,
    }),
  );
  await json(
    await post(a.ctx, `/api/outgoing-invoices/${created.id}/ready`, {}),
  );
  await json(
    await a.ctx.delete("/api/clients/" + client.id, { headers: origin }),
  );
  assert.equal((await status(created.id)).status, "DRAFT");
  const reverts = await sql(
    `SELECT metadata FROM "ActivityLog" WHERE action='INVOICE_REVERTED_TO_DRAFT' AND "entityId"=$1 ORDER BY "createdAt"`,
    [created.id],
  );
  assert.deepEqual(
    reverts.map((r) => r.metadata.reason),
    ["CLIENT_UPDATED", "FISCAL_PROFILE_UPDATED", "CLIENT_ARCHIVED"],
  );
  pass(
    "changing relevant client or profile data returns READY invoices to DRAFT with a new version",
  );

  await writeFile(
    "test-results/phase5c-e2e-summary.json",
    JSON.stringify(
      { passed: true, checks, database: "ephemeral local PGlite; no Neon" },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile("test-results/phase5c-server.log", logs);
  await writeFile(
    "test-results/phase5c-e2e-summary.json",
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
