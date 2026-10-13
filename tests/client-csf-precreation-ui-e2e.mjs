import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startDatabase } from "../scripts/local-database.mjs";
import { syntheticCsf } from "./fixtures/synthetic-csf.mjs";

// Real UI + APIs and ephemeral local database. The sole injected response is a
// privacy rejection (never a success); production enforcement has its own real E2E.
const database = await startDatabase();
const baseURL = "http://localhost:3101";
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
app.stdout.on("data", (data) => {
  logs += data;
});
app.stderr.on("data", (data) => {
  logs += data;
});
const checks = [];
const pass = (message) => {
  checks.push(message);
  console.log("PASS " + message);
};
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
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const post = async (path, data, status = 200) => {
    const response = await context.request.post(path, {
      headers: { Origin: baseURL },
      data,
    });
    assert.equal(response.status(), status, await response.text());
    return response.json();
  };
  await post("/api/auth/sign-up/email", {
    name: "Precreation UI QA",
    email: "precreation-ui@example.test",
    password: randomBytes(24).toString("base64url") + "-9aZ",
  });
  const org = await post(
    "/api/organizations",
    { name: "Precreation UI isolated QA" },
    201,
  );
  const page = await context.newPage();
  const browserErrors = [],
    analytics = [],
    requests = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST") requests.push(request);
    if (/\/(_vercel\/insights|va\/|analytics)/.test(request.url()))
      analytics.push(request.url() + (request.postData() ?? ""));
  });
  await page.goto("/dashboard/clients");
  await page.getByRole("button", { name: "Rechazar analíticas" }).click();
  const form = page.locator("form.fiscal-ui");
  const csf = form.locator(".fiscal-csf");
  const confirm = () =>
    form.getByRole("checkbox", {
      name: "Revisé y confirmo que los datos fiscales del cliente son correctos.",
    });
  const authorize = () =>
    csf.getByRole("checkbox", { name: /^Declaro que cuento/ });
  const read = () =>
    csf.getByRole("button", {
      name: "Leer y prellenar constancia",
      exact: true,
    });
  const countUploads = () =>
    requests.filter(
      (request) => new URL(request.url()).pathname === "/api/private-assets",
    ).length;
  async function open() {
    await page.getByRole("button", { name: "Nuevo cliente" }).click();
    await expect(form).toBeVisible();
  }
  async function upload(name = "csf-sintetica.pdf", bytes) {
    const response = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/private-assets") &&
        res.request().method() === "POST",
    );
    await form.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: "application/pdf",
      buffer:
        bytes ??
        (await syntheticCsf({
          rfc: "AAA010101AAA",
          companyName: "CLIENTE SINTETICO QA",
        })),
    });
    const result = await response;
    assert.equal(result.status(), 201);
    const asset = await result.json();
    await expect(csf.locator(".fiscal-upload-name")).toContainText(
      asset.fileName,
    );
    await expect(authorize()).toBeEnabled();
    return asset;
  }
  async function selectCode(label, code) {
    const input = form.getByRole("combobox", { name: label, exact: true });
    await input.fill(code);
    await expect(
      page.getByRole("option").filter({ hasText: code }).first(),
    ).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
  }
  async function fillManual(name = "CLIENTE MANUAL QA") {
    for (const [key, value] of Object.entries({
      rfc: "BBB010101BBB",
      legalName: name,
      postalCode: "06000",
      email: "client@example.test",
    }))
      await form.locator(`input[name="${key}"]`).fill(value);
    await selectCode("Régimen fiscal", "601");
    await selectCode("Uso CFDI", "G03");
  }
  async function save(status = 201) {
    await confirm().check();
    const result = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === "/api/clients" &&
        res.request().method() === "POST",
    );
    await form
      .getByRole("button", { name: "Guardar cliente", exact: true })
      .click();
    const response = await result;
    assert.equal(response.status(), status, await response.text());
    return response;
  }
  await open();
  const uploadButton = csf.getByRole("button", { name: "Subir constancia" });
  await expect(uploadButton).toBeVisible();
  assert.equal(await csf.locator(".fiscal-upload-icon").count(), 1);
  await uploadButton.focus();
  const picker = page.waitForEvent("filechooser");
  await uploadButton.press("Enter");
  await (await picker).setFiles([]);
  await expect(read()).toBeDisabled();
  await expect(form).not.toContainText("Guarda primero el cliente");
  let asset = await upload();
  await expect(authorize()).not.toBeChecked();
  await expect(read()).toBeDisabled();
  await authorize().check();
  const firstId = asset.id;
  asset = await upload("reemplazo-sintetico.pdf");
  assert.notEqual(asset.id, firstId);
  await expect(authorize()).not.toBeChecked();
  await csf.getByRole("button", { name: "Quitar archivo" }).click();
  await expect(csf.locator(".fiscal-upload-name")).toHaveCount(0);
  await expect(read()).toBeDisabled();
  assert.equal(
    (await context.request.get("/api/clients").then((r) => r.json())).length,
    0,
  );
  pass(
    "accessible upload icon/button, keyboard picker, selected name, replace/remove and no client before save",
  );

  await form.locator('input[name="interiorNumber"]').fill("INTERIOR MANUAL");
  await form.locator('input[name="email"]').fill("corrected@example.test");
  asset = await upload();
  const beforeRead = countUploads();
  await authorize().check();
  const extractionResponse = page.waitForResponse((res) =>
    /\/api\/fiscal-extractions\/[^/]+$/.test(res.url()),
  );
  await read().click();
  const extraction = await (await extractionResponse).json();
  await expect(form.locator('input[name="rfc"]')).toHaveValue("AAA010101AAA");
  await expect(form.locator('input[name="legalName"]')).toHaveValue(
    extraction.fields.legalName.value,
  );
  await expect(form.locator('input[name="postalCode"]')).toHaveValue("42501");
  await expect(form.locator('input[name="interiorNumber"]')).toHaveValue(
    "INTERIOR MANUAL",
  );
  await expect(form.locator('input[name="email"]')).toHaveValue(
    "corrected@example.test",
  );
  await expect(form.locator('input[name="cfdiUse"]')).toHaveValue("");
  await expect(form.locator('input[name="fiscalRegime"]')).toHaveValue("");
  await expect(confirm()).toBeDisabled();
  const consentPost = requests
    .findLast((request) => request.url().endsWith("/api/fiscal-consents"))
    .postDataJSON();
  assert.equal(consentPost.newClient, true);
  assert.equal(consentPost.clientId, undefined);
  assert.equal(extraction.clientId, null);
  assert.equal(extraction.documentId, asset.id);
  pass(
    "real newClient consent and correlated extraction prefill only available fields; no automatic regime/contact/use",
  );

  // Long private filename, all requested sizes and a11y after prefill.
  const widths = [360, 390, 430, 768, 820, 1024, 1280, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "no horizontal overflow at " + width,
    );
    const audit = await new AxeBuilder({ page })
      .include("form.fiscal-ui")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
    );
  }
  pass(
    "360/390/430/768/820/1024/1280/1440 prefilled form responsive; 8 WCAG Axe audits",
  );
  await selectCode("Régimen fiscal", "601");
  await selectCode("Uso CFDI", "G03");
  await form.locator('input[name="legalName"]').fill("CLIENTE CORREGIDO QA");
  await expect(read()).toBeDisabled();
  // A real server validation failure must preserve both reference and visible values.
  await form.locator('input[name="rfc"]').fill("INVALID");
  await save(400);
  await expect(form).toBeVisible();
  await expect(form.locator('input[name="legalName"]')).toHaveValue(
    "CLIENTE CORREGIDO QA",
  );
  await expect(csf.locator(".fiscal-upload-name")).toBeVisible();
  assert.equal(
    (await context.request.get("/api/clients").then((r) => r.json())).length,
    0,
  );
  await form.locator('input[name="rfc"]').fill("AAA010101AAA");
  const saved = await save();
  const body = saved.request().postDataJSON(),
    client = await saved.json();
  assert.equal(body.precreationCsfReference, asset.precreationCsfReference);
  assert.equal(body.extractionId, extraction.id);
  assert.equal(body.confirmed, true);
  assert.equal(client.csfDocumentId, asset.id);
  assert.equal(client.organizationId, org.id);
  assert.equal(client.sourceExtractionId, extraction.id);
  assert.equal(client.legalName, "CLIENTE CORREGIDO QA");
  assert.equal(countUploads(), beforeRead);
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "CLIENTE CORREGIDO QA" }),
  ).toBeVisible();
  pass(
    "real create failure retains capture/reference; corrections persist, single upload linked and list refreshes",
  );

  await open();
  await fillManual("CLIENTE PRIVACIDAD QA");
  const longName = "constancia-" + "nombreprivado".repeat(14) + ".pdf";
  asset = await upload(longName);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  await page.route("**/api/fiscal-consents", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PRIVACY_NOTICE_MISSING",
        error: "PRIVATE INTERNAL DETAIL",
      }),
    }),
  );
  await authorize().check();
  await read().click();
  await expect(csf.getByRole("alert")).toContainText(
    "La constancia quedó cargada, pero la lectura automática no está disponible",
  );
  await expect(csf).not.toContainText("PRIVATE INTERNAL DETAIL");
  await page.unroute("**/api/fiscal-consents");
  const manualSave = await save();
  assert.equal((await manualSave.json()).csfDocumentId, asset.id);
  assert.equal(manualSave.request().postDataJSON().extractionId, undefined);
  const storage = await page.evaluate(() =>
    JSON.stringify([localStorage, sessionStorage, document.cookie]),
  );
  for (const sensitive of [
    longName,
    asset.precreationCsfReference,
    asset.id,
    "CLIENTE PRIVACIDAD QA",
    "BBB010101BBB",
  ])
    assert(
      !storage.includes(sensitive) && !analytics.join(" ").includes(sensitive),
    );
  pass(
    "privacy rejection keeps uploaded CSF for manual real creation; long filename reflows; no sensitive storage/analytics",
  );

  await open();
  await fillManual("CLIENTE ILEGIBLE QA");
  asset = await upload("ilegible.pdf", await syntheticCsf({ blank: true }));
  await authorize().check();
  await read().click();
  await expect(
    form.getByRole("region", { name: "Revisión de información detectada" }),
  ).toContainText("No pudimos leer el PDF");
  await expect(form.locator('input[name="rfc"]')).toHaveValue("BBB010101BBB");
  await expect(form.locator('input[name="legalName"]')).toHaveValue(
    "CLIENTE ILEGIBLE QA",
  );
  await form.getByRole("button", { name: "Cancelar", exact: true }).click();
  pass(
    "real UNREADABLE leaves manual values intact and cancel abandons only local state",
  );

  for (const mode of ["expired", "consumed"]) {
    await open();
    await fillManual();
    asset = await upload();
    if (mode === "expired")
      await database.db.query(
        'UPDATE "Document" SET "createdAt"=NOW()-INTERVAL \'25 hours\' WHERE id=$1',
        [asset.id],
      );
    else
      await post(
        "/api/clients",
        {
          rfc: "DDD010101DDD",
          legalName: "CLIENTE CONSUMIDOR QA",
          fiscalRegime: "601",
          cfdiUse: "G03",
          postalCode: "06000",
          email: "consumed@example.test",
          country: "MEX",
          personType: "COMPANY",
          defaultPaymentForm: "99",
          confirmed: true,
          precreationCsfReference: asset.precreationCsfReference,
        },
        201,
      );
    await save(mode === "expired" ? 410 : 409);
    await expect(form.getByRole("alert")).toContainText(
      mode === "expired" ? "La constancia venció" : "ya se vinculó",
    );
    await expect(csf.locator(".fiscal-upload-name")).toHaveCount(0);
    await expect(form.locator('input[name="legalName"]')).toHaveValue(
      "CLIENTE MANUAL QA",
    );
    await form.getByRole("button", { name: "Cancelar", exact: true }).click();
  }
  pass(
    "real expired/consumed reference failures remove unusable CSF without losing capture or creating phantom client",
  );
  assert.deepEqual(browserErrors, []);
  assert(!logs.includes(asset.precreationCsfReference));
  console.log(
    `PASS ${checks.length} groups; synthetic local data only; no backend changes, CSD or PAC`,
  );
  await context.close();
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
