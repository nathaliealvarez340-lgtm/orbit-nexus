import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import AxeBuilder from "@axe-core/playwright";
import { startDatabase } from "../scripts/local-database.mjs";
const expect = playwrightExpect.configure({ timeout: 20000 });
// All business APIs are real. Only synthetic account/document data is created locally.
const database = await startDatabase(),
  baseURL = "http://localhost:3101";
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3101",
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
      NODE_USE_SYSTEM_CA: "1",
    },
  },
);
let browser,
  logs = "";
app.stdout.on("data", (buffer) => {
  logs += buffer;
});
app.stderr.on("data", (buffer) => {
  logs += buffer;
});
const checks = [],
  errors = [],
  origin = { Origin: baseURL };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log("PASS " + label);
};
async function json(response, status = 200) {
  assert.equal(
    response.status(),
    status,
    `Expected ${status}: ${await response.text()}`,
  );
  return response.json();
}
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/invoice-studio-e2e-summary.json",
  JSON.stringify({ passed: false }),
);
try {
  for (let i = 0; i < 120 && !logs.includes("Ready in"); i++) {
    if (app.exitCode !== null) throw new Error("Local server failed to start");
    await pause(500);
  }
  assert(logs.includes("Ready in"));
  browser = await chromium.launch({
    headless: true,
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.platform === "win32" ? "msedge" : undefined),
  });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  const post = (path, data, headers = {}) =>
    context.request.post(path, { headers: { ...origin, ...headers }, data });
  await json(
    await post("/api/auth/sign-up/email", {
      name: "Studio QA",
      email: "studio-qa@example.test",
      password: randomBytes(24).toString("base64url") + "-9aZ",
    }),
  );
  const org = await json(
    await post("/api/organizations", { name: "Studio local QA" }),
    201,
  );
  await page.goto("/dashboard/invoices/new");
  await page.getByRole("button", { name: "Rechazar no esenciales" }).click();
  await expect(
    page.getByRole("heading", { name: "Facturas · PRO / MAX" }),
  ).toBeVisible();
  await json(await context.request.get("/api/outgoing-invoices/context"), 403);
  pass("real server-side FREE plan gating remains enforced");
  await database.db.query(
    'INSERT INTO "Subscription" ("organizationId",plan,"updatedAt") VALUES ($1,$2,NOW())',
    [org.id, "PRO"],
  );
  const party = {
    rfc: "BBB010101BBB",
    legalName: "Cliente de prueba",
    personType: "COMPANY",
    fiscalRegime: "601",
    cfdiUse: "G03",
    defaultPaymentForm: "03",
    email: "client@example.test",
    postalCode: "06000",
    street: "Prueba",
    exteriorNumber: "1",
    colony: "Centro",
    locality: "Ciudad",
    municipality: "Municipio",
    state: "Estado",
    country: "MEX",
  };
  const client = await json(await post("/api/clients", party), 201);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage().drawText("SYNTHETIC LOCAL QA CSF");
  const pdf = Buffer.from(await pdfDoc.save());
  const upload = (kind, name, mimeType, buffer) =>
    context.request.post("/api/private-assets", {
      headers: origin,
      multipart: { kind, file: { name, mimeType, buffer } },
    });
  const csf = await json(
    await upload("CSF", "qa-csf.pdf", "application/pdf", pdf),
    201,
  );
  await json(
    await post("/api/fiscal-profile", {
      ...party,
      rfc: "AAA010101AAA",
      legalName: "Emisor local QA",
      email: "issuer@example.test",
      confirmed: true,
      csfDocumentId: csf.id,
    }),
  );
  const png = await sharp({
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
    await upload("INVOICE_LOGO", "qa-logo.png", "image/png", png),
    201,
  );
  await json(
    await post("/api/outgoing-invoices/settings", {
      prefix: "ORB",
      template: "CLASSIC",
      color: "#3b82f6",
      logoDocumentId: logo.id,
      currencyDefault: "MXN",
      paymentMethodDefault: "PUE",
    }),
  );
  const template = {
    name: "Consultoría QA",
    description: "Servicio del catálogo",
    productCode: "80101500",
    unitCode: "E48",
    defaultQuantity: "1",
    unitPrice: "100.00",
    taxObject: "02",
    vatFactor: "TASA",
    vatRate: "0.16",
  };
  const concept = await json(
    await post("/api/invoice-concepts", template),
    201,
  );
  const studioContext = await json(
    await context.request.get("/api/outgoing-invoices/context"),
  );
  assert(studioContext.issuer.profileComplete);
  assert(studioContext.savedConcepts.some((item) => item.id === concept.id));
  await page.goto("/dashboard/invoices/new");
  await expect(
    page.getByLabel("Cliente receptor", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Cliente receptor", { exact: true })
    .fill("Cliente de prueba");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Cliente receptor", { exact: true }),
  ).toHaveValue("Cliente de prueba · BBB010101BBB");
  await expect(page.getByLabel("Forma de pago", { exact: true })).toHaveValue(
    /03/,
  );
  await expect(
    page.getByLabel("Tipo de comprobante").locator('option[value="E"]'),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Tipo de comprobante").locator('option[value="T"]'),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Validar datos", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Describe el concepto/ }),
  ).toBeVisible();
  const structural = await json(
    await post("/api/outgoing-invoices/validate", {
      clientId: client.id,
      concepts: [],
    }),
  );
  assert.equal(structural.totals, null);
  assert(structural.validation.issues.length);
  pass(
    "real context, explicit client defaults and null-totals structural validation render correctly",
  );
  await page.getByLabel("Agregar concepto guardado").fill("Consultoría");
  await expect(
    page.getByRole("option", { name: /Consultoría QA/ }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Descripción · Concepto 2")).toHaveValue(
    "Servicio del catálogo",
  );
  await page
    .getByRole("button", { name: "Eliminar concepto 1", exact: true })
    .click();
  await expect(page.getByLabel("Descripción · Concepto 1")).toBeFocused();
  await page
    .getByLabel("Descripción · Concepto 1")
    .fill("Servicio editado en factura");
  const templates = await json(
    await context.request.get("/api/invoice-concepts?q=Consultor"),
  );
  assert.equal(templates[0].description, template.description);
  pass("real saved-concept search creates independent editable snapshots");
  await page
    .getByLabel("Clave producto/servicio · Concepto 1")
    .fill("80101500");
  await expect(page.getByRole("option", { name: /80101500/ })).toBeVisible();
  await expect(
    page.getByText(
      "Cobertura parcial del catálogo SAT. El servidor verifica las claves disponibles.",
    ),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.getByLabel("Unidad · Concepto 1", { exact: true }).fill("E48");
  await expect(page.getByRole("option", { name: /E48/ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const catalog = await json(
    await context.request.get(
      "/api/fiscal-catalogs/product-services?q=80101500&limit=30",
    ),
  );
  assert.equal(catalog.complete, false);
  assert.equal(catalog.results[0].code, "80101500");
  pass(
    "real SAT search uses canonical identifiers and discloses curated coverage",
  );
  await page.getByLabel("Método de pago", { exact: true }).selectOption("PPD");
  await page
    .getByRole("button", { name: "Validar datos", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Con método PPD/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Con método PPD/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Forma de pago", exact: true }),
  ).toBeFocused();
  let posts = 0,
    creationRequest;
  page.on("request", (request) => {
    if (
      request.url() === baseURL + "/api/outgoing-invoices" &&
      request.method() === "POST"
    ) {
      posts++;
      creationRequest = request;
    }
  });
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .evaluate((element) => {
      element.click();
      element.click();
    });
  await expect(
    page.getByText(
      "Borrador guardado. Puedes continuar editando o revisar el documento.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(posts, 1);
  const [row] = (
    await database.db.query(
      'SELECT id,status,uuid FROM "StampedInvoice" WHERE "organizationId"=$1',
      [org.id],
    )
  ).rows;
  assert.equal(row.status, "DRAFT");
  assert.equal(row.uuid, null);
  const id = row.id;
  let detail = await json(
    await context.request.get("/api/outgoing-invoices/" + id),
  );
  assert.equal(detail.totals.total, "116.00");
  assert.equal(detail.validation.canMarkReady, false);
  const replay = await json(
    await post("/api/outgoing-invoices", creationRequest.postDataJSON(), {
      "Idempotency-Key": creationRequest.headers()["idempotency-key"],
    }),
  );
  assert.equal(replay.id, id);
  await page
    .getByRole("button", { name: "Revisión final", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Marcar borrador como listo" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  pass(
    "real invalid fiscal draft persists official totals; duplicate clicks and idempotency replay keep one draft",
  );
  await page.getByRole("button", { name: "Usar forma de pago 99" }).click();
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .click();
  await expect(
    page.getByText(
      "Borrador guardado. Puedes continuar editando o revisar el documento.",
      { exact: true },
    ),
  ).toBeVisible();
  detail = await json(
    await context.request.get("/api/outgoing-invoices/" + id),
  );
  assert.equal(detail.folio, "ORB-000001");
  assert(detail.validation.canMarkReady);
  await page
    .getByRole("button", { name: "Revisión final", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Marcar borrador como listo" })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Borrador listo para revisión",
  );
  detail = await json(
    await context.request.get("/api/outgoing-invoices/" + id),
  );
  assert.equal(detail.status, "READY");
  assert.equal(detail.uuid, null);
  const reviewAxe = await new AxeBuilder({ page })
    .include(".studio-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    reviewAxe.violations.map((item) => item.id),
    [],
  );
  await page.keyboard.press("Escape");
  pass(
    "real PATCH retains folio and real READY is confirmed without PAC or UUID; review passes Axe",
  );
  await page.goto("/dashboard/invoices/new?draft=" + id);
  await expect(page.getByLabel("Descripción · Concepto 1")).toHaveValue(
    "Servicio editado en factura",
  );
  await expect(
    page.getByRole("combobox", {
      name: "Clave producto/servicio · Concepto 1",
      exact: true,
    }),
  ).toHaveValue(`80101500 · ${catalog.results[0].label}`);
  await page
    .getByLabel("Descripción · Concepto 1")
    .fill("Editado después de READY");
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .click();
  await expect(
    page.getByText(
      "Borrador guardado. Puedes continuar editando o revisar el documento.",
      { exact: true },
    ),
  ).toBeVisible();
  detail = await json(
    await context.request.get("/api/outgoing-invoices/" + id),
  );
  assert.equal(detail.status, "DRAFT");
  assert.equal(detail.concepts[0].savedConceptId, concept.id);
  pass(
    "reopening restores real snapshots and editing READY returns it to DRAFT",
  );
  for (const width of [1440, 1280, 820, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Studio overflow at ${width}`,
    );
    const axe = await new AxeBuilder({ page })
      .include(".orbit-app")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      axe.violations.map((item) => ({
        id: item.id,
        targets: item.nodes.map((node) => node.target),
      })),
      [],
      `Axe at ${width}`,
    );
    await page.screenshot({
      path: `test-results/invoice-studio-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Vista previa", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    assert(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    );
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Vista previa", exact: true }),
    ).toBeFocused();
  }
  pass(
    "five responsive widths and preview pass overflow, Axe and keyboard focus checks",
  );
  for (const accent of ["PURPLE", "BLUE", "ORANGE", "RED"]) {
    await json(await post("/api/user/preferences", { accent }));
    await page.goto("/dashboard/invoices/new?draft=" + id);
    await expect(page.getByLabel("Descripción · Concepto 1")).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .include(".invoice-studio")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      axe.violations.map((item) => item.id),
      [],
      accent,
    );
  }
  pass("four user accents pass Axe");
  // A second real API writer changes the same draft after this page loaded.
  detail = await json(
    await context.request.get("/api/outgoing-invoices/" + id),
  );
  await json(
    await context.request.patch("/api/outgoing-invoices/" + id, {
      headers: origin,
      data: {
        ...detail,
        expectedUpdatedAt: detail.updatedAt,
        concepts: detail.concepts.map((line) => ({
          ...line,
          description: "Cambio en otra sesión",
        })),
      },
    }),
  );
  await page
    .getByLabel("Descripción · Concepto 1")
    .fill("Mi captura sin sobrescribir");
  const conflictResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith("/" + id),
  );
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .click();
  const conflict = await json(await conflictResponse, 409);
  assert.equal(conflict.code, "DRAFT_CONFLICT");
  await expect(
    page.locator(".invoice-studio").getByRole("alert"),
  ).toContainText("Otro cambio actualizó este borrador");
  await expect(page.getByLabel("Descripción · Concepto 1")).toHaveValue(
    "Mi captura sin sobrescribir",
  );
  await expect(
    page.getByRole("button", { name: "Guardar borrador", exact: true }),
  ).toBeDisabled();
  detail = await json(
    await context.request.get("/api/outgoing-invoices/" + id),
  );
  assert.equal(detail.concepts[0].description, "Cambio en otra sesión");
  pass(
    "real DRAFT_CONFLICT/409 preserves capture and prevents overwriting another session",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/invoice-studio-e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        database: "isolated local PGlite, localhost:3101",
        boundary:
          "real Fase 5A APIs and persistence; no business response mocks",
        browserErrors: errors.length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    "test-results/invoice-studio-e2e-summary.json",
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  await writeFile(
    "test-results/invoice-studio-e2e-failure.png.txt",
    "See invoice-studio-server.log for local diagnostics.",
  );
  await writeFile("test-results/invoice-studio-server.log", logs);
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
