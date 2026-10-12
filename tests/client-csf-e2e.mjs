import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { startDatabase } from "../scripts/local-database.mjs";
import { syntheticCsf } from "./fixtures/synthetic-csf.mjs";

// Regression E2E for the client persistence and client CSF reports, and for the rule that
// an invoice DRAFT never needs a CSD. Real local server (`npm run build` first), ephemeral
// PGlite and synthetic data only; no CSD is ever configured, nothing is sealed or stamped.
const database = await startDatabase();
const port = 3124;
const baseURL = "http://localhost:" + port;
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
      PAC_ENVIRONMENT: "SANDBOX",
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
let logs = "",
  browser;
app.stdout.on("data", (chunk) => (logs += chunk));
app.stderr.on("data", (chunk) => (logs += chunk));
const checks = [];
const pass = (message) => {
  checks.push(message);
  console.log("PASS " + message);
};
const sql = async (text, values = []) =>
  (await database.db.query(text, values)).rows;
const confirmation =
  "Revisé y confirmo que los datos fiscales del cliente son correctos.";
const mexicoToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
const pdf = async (text = "SYNTHETIC LOCAL PDF") => {
  const document = await PDFDocument.create();
  document.addPage().drawText(text);
  return Buffer.from(await document.save());
};

await mkdir("test-results", { recursive: true });
try {
  for (let i = 0; i < 120 && !logs.includes("Ready in"); i++) {
    if (app.exitCode !== null) throw new Error("Local server failed to start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(logs.includes("Ready in"));
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === "win32" ? "msedge" : undefined,
  });

  // Two isolated tenants, each with its own session.
  async function tenant(label) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    const call = async (method, path, data, status) => {
      const response = await context.request.fetch(path, {
        method,
        headers: { Origin: baseURL },
        ...(data instanceof FormData || data?.multipart
          ? { multipart: data.multipart }
          : data !== undefined
            ? { data }
            : {}),
      });
      if (status !== undefined)
        assert.equal(response.status(), status, await response.text());
      return response;
    };
    const json = async (method, path, data, status = 200) =>
      (await call(method, path, data, status)).json();
    await json("POST", "/api/auth/sign-up/email", {
      name: label,
      email: label.toLowerCase().replace(/\W+/g, "-") + "@example.test",
      password: randomBytes(24).toString("base64url") + "-9aZ",
    });
    const org = await json(
      "POST",
      "/api/organizations",
      { name: label + " org" },
      201,
    );
    await sql(
      'INSERT INTO "Subscription" ("organizationId",plan,"updatedAt") VALUES ($1,$2,NOW())',
      [org.id, "PRO"],
    );
    const upload = (kind, name, mimeType, buffer, status) =>
      call(
        "POST",
        "/api/private-assets",
        { multipart: { kind, file: { name, mimeType, buffer } } },
        status,
      );
    return { context, org, call, json, upload };
  }
  const a = await tenant("Client CSF QA A");
  const b = await tenant("Client CSF QA B");

  const page = await a.context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const clientPosts = [],
    assetPosts = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path === "/api/clients") clientPosts.push(request);
    if (path === "/api/private-assets") assetPosts.push(request);
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Rechazar analíticas" }).click();

  const form = page.locator("form.fiscal-ui");
  const pick = async (label, code) => {
    const input = page.getByRole("combobox", { name: label, exact: true });
    await input.fill(code);
    await expect(
      page.getByRole("option").filter({ hasText: code }).first(),
    ).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
  };
  const fillClient = async ({ rfc, legalName, email }) => {
    await page.locator('input[name="rfc"]').fill(rfc);
    await page.locator('input[name="legalName"]').fill(legalName);
    await page.locator('input[name="postalCode"]').fill("06000");
    await page.locator('input[name="email"]').fill(email);
  };

  // --- 1. Root cause: a blocked save was silent -------------------------------------------
  await page.goto("/dashboard/clients");
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  await fillClient({
    rfc: "EKU9003173C9",
    legalName: "Cliente Persistente QA",
    email: "persistente@example.test",
  });
  await pick("Régimen fiscal", "601");
  await pick("Uso CFDI", "G03");
  const save = page.getByRole("button", {
    name: "Guardar cliente",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(form.getByRole("alert")).toContainText(confirmation);
  await expect(
    page.getByRole("checkbox", { name: confirmation }),
  ).toBeFocused();
  await page.getByRole("checkbox", { name: confirmation }).check();
  await expect(form.getByRole("alert")).toHaveCount(0);
  // Editing after confirming resets the confirmation; Enter now explains it too.
  await page.locator('input[name="phone"]').fill("5555555555");
  await expect(
    page.getByRole("checkbox", { name: confirmation }),
  ).not.toBeChecked();
  await page.locator('input[name="email"]').press("Enter");
  await expect(form.getByRole("alert")).toContainText(confirmation);
  assert.equal(clientPosts.length, 0);
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM "Client"'))[0].n, 0);
  await expect(page.locator('input[name="legalName"]')).toHaveValue(
    "Cliente Persistente QA",
  );
  // A new client's CSF waits for the first save, and the disabled input says so.
  const newClientFile = form.locator('input[type="file"]');
  await expect(newClientFile).toBeDisabled();
  const describedBy = await newClientFile.getAttribute("aria-describedby");
  await expect(page.locator(`[id="${describedBy}"]`)).toContainText(
    "Guarda primero el cliente",
  );
  assert(
    Number(await newClientFile.evaluate((n) => getComputedStyle(n).opacity)) <
      1,
    "a disabled control must look disabled",
  );
  pass(
    "a blocked client save explains why, focuses the confirmation, sends nothing and keeps the capture",
  );

  // --- 2. Create: persisted in the session's Organization, listed without reload ---------
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  await page.getByRole("checkbox", { name: confirmation }).check();
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/clients" &&
      response.request().method() === "POST",
  );
  await save.click();
  const createdResponse = await created;
  assert.equal(createdResponse.status(), 201);
  const createdBody = createdResponse.request().postDataJSON();
  assert.equal("organizationId" in createdBody, false);
  const client = await createdResponse.json();
  assert.equal(client.organizationId, a.org.id);
  const stored = await sql(
    'SELECT "organizationId", "legalName", "confirmedAt" IS NOT NULL AS confirmed FROM "Client" WHERE id=$1',
    [client.id],
  );
  assert.deepEqual(stored, [
    {
      organizationId: a.org.id,
      legalName: "Cliente Persistente QA",
      confirmed: true,
    },
  ]);
  await expect(
    page.getByRole("status").filter({
      hasText: "✓ Información guardada correctamente",
    }),
  ).toBeVisible();
  await expect(form).toHaveCount(0);
  const row = page
    .getByRole("row")
    .filter({ hasText: "Cliente Persistente QA" });
  await expect(row).toBeVisible();
  assert.equal(await page.evaluate(() => window.__sameDocument), true);
  const listed = await a.json("GET", "/api/clients");
  assert.deepEqual(
    listed.map((item) => item.id),
    [client.id],
  );
  const studio = await a.json("GET", "/api/outgoing-invoices/context");
  assert(studio.clients.some((item) => item.id === client.id));
  pass(
    "creating a client persists it in the session's Organization and lists it without a manual reload",
  );

  // --- 3. Tenant isolation -----------------------------------------------------------------
  assert.deepEqual(await b.json("GET", "/api/clients"), []);
  assert(
    !(await b.json("GET", "/api/outgoing-invoices/context")).clients.some(
      (item) => item.id === client.id,
    ),
  );
  await b.call(
    "PATCH",
    "/api/clients/" + client.id,
    { ...createdBody, legalName: "Ajeno" },
    404,
  );
  await b.call("DELETE", "/api/clients/" + client.id, undefined, 404);
  const foreignPage = await b.context.newPage();
  await foreignPage.goto("/dashboard/clients");
  await expect(
    foreignPage.getByText("No hay clientes para esta búsqueda."),
  ).toBeVisible();
  await foreignPage.close();
  assert.equal(
    (await sql('SELECT "legalName" FROM "Client" WHERE id=$1', [client.id]))[0]
      .legalName,
    "Cliente Persistente QA",
  );
  pass("another Organization never lists, reads, edits or archives the client");

  // --- 4. Backend errors are shown; nothing is created -------------------------------------
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  await fillClient({
    rfc: "EKU9003173C9",
    legalName: "Cliente Rechazado QA",
    email: "rechazado@example.test",
  });
  await page.locator('select[name="personType"]').selectOption("INDIVIDUAL");
  await pick("Régimen fiscal", "612");
  await pick("Uso CFDI", "G03");
  await page.getByRole("checkbox", { name: confirmation }).check();
  const rejected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/clients" &&
      response.request().method() === "POST",
  );
  await save.click();
  assert.equal((await rejected).status(), 400);
  await expect(form.getByRole("alert")).toContainText("Revisa los campos");
  await expect(page.locator('input[name="rfc"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(form).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Cliente Rechazado QA" }),
  ).toHaveCount(0);
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM "Client"'))[0].n, 1);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  pass(
    "a backend rejection is shown on the field, keeps the form open and creates no phantom client",
  );

  // --- 5. Client CSF: selectable, private, limited ----------------------------------------
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  const fileInput = form.locator('input[type="file"]');
  await expect(fileInput).toBeEnabled();
  const csfBytes = await syntheticCsf({
    rfc: "EKU9003173C9",
    companyName: "CLIENTE PERSISTENTE QA",
  });
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/private-assets") &&
      response.request().method() === "POST",
  );
  await fileInput.setInputFiles({
    name: "constancia.pdf",
    mimeType: "application/pdf",
    buffer: csfBytes,
  });
  const uploadResponse = await uploaded;
  assert.equal(uploadResponse.status(), 201);
  const document = await uploadResponse.json();
  // Client CSF uploads also return the pre-creation reference (CLIENT-CSF-PRECREATION.md).
  assert.deepEqual(Object.keys(document).sort(), [
    "expiresAt",
    "fileName",
    "id",
    "precreationCsfReference",
  ]);
  assert.deepEqual(
    await sql(
      'SELECT kind, "organizationId", "mimeType" FROM "Document" WHERE id=$1',
      [document.id],
    ),
    [
      {
        kind: "CLIENT_CSF",
        organizationId: a.org.id,
        mimeType: "application/pdf",
      },
    ],
  );
  await b.call("GET", "/api/documents/" + document.id, undefined, 404);
  const anonymous = await browser.newContext({ baseURL });
  assert.equal(
    (await anonymous.request.get("/api/documents/" + document.id)).status(),
    401,
  );
  await anonymous.close();
  // Wrong type and size are refused in the browser before any request.
  const before = (await sql('SELECT COUNT(*)::int AS n FROM "Document"'))[0].n;
  const sentUploads = assetPosts.length;
  await fileInput.setInputFiles({
    name: "constancia.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("no es un PDF"),
  });
  await expect(form.locator(".fiscal-csf").getByRole("alert")).toContainText(
    "Selecciona un PDF de hasta 10 MB.",
  );
  await fileInput.setInputFiles({
    name: "grande.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(10 * 1024 * 1024),
    ]),
  });
  await expect(form.locator(".fiscal-csf").getByRole("alert")).toContainText(
    "Selecciona un PDF de hasta 10 MB.",
  );
  assert.equal(assetPosts.length, sentUploads);
  // And the server enforces the same rules without the UI.
  const png = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  for (const [name, mimeType, buffer] of [
    ["constancia.pdf", "application/pdf", png],
    ["constancia.pdf", "application/pdf", Buffer.from("%PDF-1.7 roto")],
    ["constancia.png", "image/png", png],
    [
      "grande.pdf",
      "application/pdf",
      Buffer.concat([await pdf(), Buffer.alloc(10 * 1024 * 1024)]),
    ],
  ]) {
    const response = await a.upload("CLIENT_CSF", name, mimeType, buffer);
    assert([400, 413].includes(response.status()), name);
  }
  assert.equal(
    (await sql('SELECT COUNT(*)::int AS n FROM "Document"'))[0].n,
    before,
  );
  pass(
    "a saved client's CSF is selectable and stored privately in its Organization; type and size are refused in the UI and the API",
  );

  // --- 6. Consent and extraction belong to an editable client of the same Organization ----
  const terms = await a.json(
    "GET",
    "/api/fiscal-consents/terms?purpose=CLIENT_FISCAL_PREFILL",
  );
  const consentRequest = {
    documentId: document.id,
    purpose: "CLIENT_FISCAL_PREFILL",
    accepted: true,
    consentVersion: terms.consentVersion,
    privacyNoticeVersion: terms.privacyNoticeVersion,
  };
  const code = async (response) => (await response.json()).code;
  assert.equal(
    await code(
      await a.call("POST", "/api/fiscal-consents", consentRequest, 400),
    ),
    "CLIENT_REQUIRED",
  );
  assert.equal(
    await code(
      await a.call(
        "POST",
        "/api/fiscal-consents",
        { ...consentRequest, clientId: "cliente-inexistente" },
        404,
      ),
    ),
    "CLIENT_NOT_AVAILABLE",
  );
  const foreignClient = await b.json(
    "POST",
    "/api/clients",
    {
      rfc: "EKU9003173C9",
      legalName: "Cliente de otra empresa",
      personType: "COMPANY",
      fiscalRegime: "601",
      cfdiUse: "G03",
      email: "otro@example.test",
      postalCode: "06000",
      confirmed: true,
    },
    201,
  );
  assert.equal(
    await code(
      await a.call(
        "POST",
        "/api/fiscal-consents",
        { ...consentRequest, clientId: foreignClient.id },
        404,
      ),
    ),
    "CLIENT_NOT_AVAILABLE",
  );
  assert.equal(
    await code(
      await b.call(
        "POST",
        "/api/fiscal-consents",
        { ...consentRequest, clientId: foreignClient.id },
        404,
      ),
    ),
    "DOCUMENT_NOT_AVAILABLE",
  );
  const consent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/fiscal-consents") &&
      response.request().method() === "POST",
  );
  const extraction = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/fiscal-extractions") &&
      response.request().method() === "POST",
  );
  await page.getByRole("checkbox", { name: /^Declaro que cuento/ }).check();
  await page
    .getByRole("button", { name: "Leer y prellenar constancia" })
    .click();
  assert.equal((await consent).status(), 201);
  const extractionResponse = await extraction;
  assert.equal(extractionResponse.status(), 201);
  const result = await extractionResponse.json();
  assert.deepEqual(
    [result.clientId, result.documentId, result.purpose],
    [client.id, document.id, "CLIENT_FISCAL_PREFILL"],
  );
  await expect(
    page.getByRole("region", { name: "Revisión de información detectada" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: /601/ }).check();
  await page.getByRole("checkbox", { name: confirmation }).check();
  const patched = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith("/api/clients/" + client.id),
  );
  await save.click();
  assert.equal((await patched).status(), 200);
  assert.deepEqual(
    await sql(
      'SELECT "csfDocumentId", "sourceExtractionId", "organizationId" FROM "Client" WHERE id=$1',
      [client.id],
    ),
    [
      {
        csfDocumentId: document.id,
        sourceExtractionId: result.id,
        organizationId: a.org.id,
      },
    ],
  );
  pass(
    "client CSF consent and extraction require an editable client of the same Organization and end associated with that client",
  );

  // --- 7. An unreadable constancia invents nothing ------------------------------------------
  const blank = await (
    await a.upload(
      "CLIENT_CSF",
      "vacia.pdf",
      "application/pdf",
      await syntheticCsf({ blank: true }),
      201,
    )
  ).json();
  const blankConsent = await a.json(
    "POST",
    "/api/fiscal-consents",
    { ...consentRequest, documentId: blank.id, clientId: client.id },
    201,
  );
  const unreadable = await a.json(
    "POST",
    "/api/fiscal-extractions",
    { consentId: blankConsent.id },
    201,
  );
  assert.equal(unreadable.status, "UNREADABLE");
  assert(
    Object.values(unreadable.fields).every((field) => field.value === null),
  );
  assert.deepEqual(unreadable.regimes, []);
  assert.equal(
    (
      await sql('SELECT "csfDocumentId" FROM "Client" WHERE id=$1', [client.id])
    )[0].csfDocumentId,
    document.id,
  );
  pass(
    "an unreadable constancia yields UNREADABLE with every value null and changes no client data",
  );

  // --- 8. Invoice DRAFT without CSD ---------------------------------------------------------
  const csd = await a.json("GET", "/api/csd");
  assert.equal(csd.status, "NOT_CONFIGURED");
  const issuerCsf = await (
    await a.upload("CSF", "emisor.pdf", "application/pdf", await pdf(), 201)
  ).json();
  await a.json("POST", "/api/fiscal-profile", {
    rfc: "AAA010101AAA",
    legalName: "EMISOR SINTETICO QA",
    fiscalRegime: "601",
    personType: "COMPANY",
    cfdiUse: "G03",
    postalCode: "06600",
    email: "emisor@example.test",
    country: "MEX",
    confirmed: true,
    csfDocumentId: issuerCsf.id,
  });
  const logo = await (
    await a.upload(
      "INVOICE_LOGO",
      "logo.png",
      "image/png",
      await sharp({
        create: {
          width: 20,
          height: 20,
          channels: 4,
          background: { r: 10, g: 20, b: 30, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer(),
      201,
    )
  ).json();
  await a.json("POST", "/api/outgoing-invoices/settings", {
    prefix: "QA",
    template: "CLASSIC",
    color: "#3b82f6",
    logoDocumentId: logo.id,
    currencyDefault: "MXN",
    paymentMethodDefault: "PUE",
  });
  const draft = {
    clientId: client.id,
    invoiceDate: mexicoToday(),
    documentType: "I",
    currency: "MXN",
    cfdiUse: "G03",
    paymentMethod: "PUE",
    paymentForm: "03",
    exportCode: "01",
    concepts: [
      {
        description: "Servicio sintético",
        productCode: "80101500",
        unitCode: "E48",
        quantity: "1",
        unitPrice: "100.00",
        taxObject: "02",
        vatFactor: "TASA",
        vatRate: "0.16",
      },
    ],
  };
  const createdDraft = await a.json(
    "POST",
    "/api/outgoing-invoices",
    draft,
    201,
  );
  assert.equal(createdDraft.status, "DRAFT");
  const updatedDraft = await a.json(
    "PATCH",
    "/api/outgoing-invoices/" + createdDraft.id,
    {
      ...draft,
      concepts: [{ ...draft.concepts[0], unitPrice: "150.00" }],
      expectedUpdatedAt: createdDraft.updatedAt,
    },
  );
  assert.equal(updatedDraft.status, "DRAFT");
  assert.equal(updatedDraft.totals.total, "174.00");
  // The new client is selectable in Invoice Studio without reloading anything by hand.
  await page.goto("/dashboard/invoices/new");
  await page
    .getByLabel("Cliente receptor", { exact: true })
    .fill("Cliente Persistente");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Cliente receptor", { exact: true }),
  ).toHaveValue("Cliente Persistente QA · EKU9003173C9");
  assert.equal((await a.json("GET", "/api/csd")).status, "NOT_CONFIGURED");
  assert.equal(
    (await sql('SELECT COUNT(*)::int AS n FROM "CsdCertificate"'))[0].n,
    0,
  );
  pass(
    "invoice DRAFT create, save and edit, and choosing the new client, work with no CSD configured",
  );

  assert.deepEqual(browserErrors, []);
  await writeFile(
    "test-results/client-csf-e2e-summary.json",
    JSON.stringify({ passed: true, checks }, null, 2),
  );
} catch (error) {
  await writeFile(
    "test-results/client-csf-e2e-summary.json",
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  await writeFile("test-results/client-csf-server.log", logs);
  throw error;
} finally {
  await browser?.close();
  if (app.exitCode === null) {
    if (process.platform === "win32")
      execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else app.kill();
    if (app.exitCode === null)
      await new Promise((resolve) => app.once("exit", resolve));
  }
  await database.close();
}
