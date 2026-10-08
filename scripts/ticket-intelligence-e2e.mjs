import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import QRCode from "qrcode";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { startDatabase } from "./local-database.mjs";

// Synthetic OCR HTTP contract fixture only; never a production OCR provider.
let mode = "success",
  calls = 0,
  release;
const rawText =
  "Comercio: Comercio OCR\nFecha: 2026-09-20\nTotal: 100.50\nMoneda: MXN\nfactura.example.com";
const fixture = {
  provider: "synthetic-http-fixture",
  rawText,
  confidence: 0.82,
  fields: {
    merchantName: "Comercio OCR",
    merchantRfc: "AAA010101AAA",
    date: "2026-09-20",
    total: "100.50",
    currency: "MXN",
    ticketNumber: "TC001",
    terminalNumber: "CAJA3",
    subtotal: null,
  },
  raw: { text: rawText, marker: "private-original-fixture" },
};
const ocr = createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  calls++;
  const currentMode = mode;
  if (currentMode === "hold")
    await new Promise((resolve) => {
      release = resolve;
    });
  if (currentMode === "delay")
    await new Promise((resolve) => setTimeout(resolve, 350));
  if (currentMode === "failure") {
    res.writeHead(503);
    res.end("private-provider-failure");
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify(
      currentMode === "missing"
        ? { provider: "synthetic-http-fixture", fields: {}, confidence: null }
        : fixture,
    ),
  );
});
await new Promise((resolve) => ocr.listen(0, "127.0.0.1", resolve));
const database = await startDatabase(),
  baseURL = "http://localhost:3201";
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3201",
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
      OCR_API_URL: `http://127.0.0.1:${ocr.address().port}`,
      OCR_API_TOKEN: "",
      MAIL_API_URL: "",
      MAIL_API_TOKEN: "",
    },
  },
);
let browser,
  logs = "";
app.stdout.on("data", (b) => (logs += b));
app.stderr.on("data", (b) => (logs += b));
const checks = [],
  errors = [],
  origin = { Origin: baseURL };
const pass = (label) => {
  checks.push(label);
  console.log("PASS " + label);
};
const sql = async (query, params = []) =>
  (await database.db.query(query, params)).rows;
const json = async (response, status = 200) => {
  assert.equal(response.status(), status, await response.text());
  return response.json();
};
const post = (context, path, data) =>
  context.request.post(path, { headers: origin, data });
const account = async (name) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  await json(
    await post(context, "/api/auth/sign-up/email", {
      name,
      email: `${name}@example.test`,
      password: `Synthetic-${randomBytes(15).toString("hex")}-9aZ`,
    }),
  );
  const org = await json(
    await post(context, "/api/organizations", { name }),
    201,
  );
  return { context, org };
};
await mkdir("test-results", { recursive: true });
try {
  const deadline = Date.now() + 45000;
  while (true) {
    try {
      if (
        (await fetch(baseURL + "/login", { signal: AbortSignal.timeout(2000) }))
          .ok
      )
        break;
    } catch {}
    if (Date.now() > deadline) throw new Error("Local server failed to start");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const a = await account("IntelligenceA"),
    b = await account("IntelligenceB");
  const page = await a.context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const qrUrl = "https://factura.example.com/";
  const png = await QRCode.toBuffer(qrUrl, { width: 500, margin: 3 });
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const upload = async (
    buffer = png,
    name = "receipt.png",
    mimeType = "image/png",
  ) =>
    json(
      await a.context.request.post("/api/tickets", {
        headers: origin,
        multipart: { file: { name, mimeType, buffer } },
      }),
      201,
    );
  const analyze = (id, context = a.context) =>
    post(context, `/api/tickets/${id}/analyze`);
  const get = async (id) =>
    json(await a.context.request.get(`/api/tickets/${id}`));
  const confirmData = {
    merchant: "Comercio corregido",
    purchaseDate: "2026-09-21",
    total: "120.25",
    currency: "MXN",
    folio: "CORREGIDO",
    billingUrl: "facturacion.example.mx/portal",
  };
  for (const [buffer, name, mimeType] of [
    [await sharp(png).jpeg().toBuffer(), "t.jpg", "image/jpeg"],
    [png, "t.png", "image/png"],
    [await sharp(png).webp().toBuffer(), "t.webp", "image/webp"],
    [Buffer.from(await pdf.save()), "t.pdf", "application/pdf"],
  ])
    await upload(buffer, name, mimeType);
  for (const [buffer, mimeType, expected] of [
    [png, "application/pdf", 400],
    [Buffer.alloc(10 * 1024 * 1024 + 1), "image/png", 413],
  ])
    await json(
      await a.context.request.post("/api/tickets", {
        headers: origin,
        multipart: { file: { name: "bad.png", mimeType, buffer } },
      }),
      expected,
    );
  pass("JPG/PNG/WEBP/PDF upload and server MIME/size validation");
  const ticket = await upload();
  await json(await b.context.request.get(`/api/tickets/${ticket.id}`), 404);
  await json(await analyze(ticket.id, b.context), 404);
  await json(
    await post(b.context, `/api/tickets/${ticket.id}/confirm`, confirmData),
    404,
  );
  await json(await analyze(ticket.id));
  const detected = await get(ticket.id);
  assert.equal(detected.status, "REVIEW");
  assert.equal(detected.extractedData.fields.total, "100.50");
  assert.equal(detected.extractedData.fields.qrPayload, qrUrl);
  assert.equal(detected.extractedData.fields.billingUrl, qrUrl);
  assert.equal(detected.extractedData.fields.subtotal, null);
  assert.equal(detected.expense, null);
  assert(!JSON.stringify(detected).includes("private-original-fixture"));
  await json(
    await b.context.request.get("/api/documents/" + detected.documentId),
    404,
  );
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM "Expense"'))[0].n, 0);
  pass(
    "HTTP OCR normalization and real QR decoding preserve null fields, raw payload privacy and tenant isolation; analysis creates no expense",
  );
  const before = (
    await sql(
      'SELECT fields,"rawResult","rawText" FROM "TicketExtractedData" WHERE "ticketId"=$1',
      [ticket.id],
    )
  )[0];
  await page.goto(`/dashboard/tickets/${ticket.id}`);
  const reject = page.getByRole("button", { name: "Rechazar no esenciales" });
  if (await reject.isVisible()) await reject.click();
  await expect(
    page.getByRole("heading", { name: "TICKET ANALIZADO" }),
  ).toBeVisible();
  await expect(page.getByLabel("Comercio", { exact: true })).toHaveValue(
    "Comercio OCR",
  );
  await page.getByLabel("Comercio", { exact: true }).fill(confirmData.merchant);
  await expect(
    page.getByText("Corregido por ti", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Fecha", { exact: true })
    .fill(confirmData.purchaseDate);
  await page.getByLabel("Total (MXN)", { exact: true }).fill(confirmData.total);
  const urlInput = page.getByLabel("URL del portal de facturación", {
    exact: true,
  });
  await urlInput.fill("javascript:alert(1)");
  await page
    .getByRole("button", { name: "Confirmar datos", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "URL web pública válida",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "http://127.0.0.1",
  ])
    await json(
      await post(a.context, `/api/tickets/${ticket.id}/confirm`, {
        ...confirmData,
        billingUrl: url,
      }),
      400,
    );
  await urlInput.fill(confirmData.billingUrl);
  for (const width of [1440, 1280, 820, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  const axe = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  await page.screenshot({
    path: "test-results/ticket-intelligence-review-360.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Confirmar datos", exact: true })
    .click();
  await expect(
    page.getByText("Confirmado y registrado", { exact: true }),
  ).toBeVisible();
  const confirmed = await get(ticket.id);
  assert.equal(confirmed.expense.total, confirmData.total);
  assert.equal(confirmed.expense.merchant, confirmData.merchant);
  assert.equal(
    confirmed.expense.purchaseDate.slice(0, 10),
    confirmData.purchaseDate,
  );
  assert.equal(
    confirmed.confirmedData.billingUrl,
    "https://facturacion.example.mx/portal",
  );
  assert.equal(confirmed.billingUrl, "https://facturacion.example.mx/portal");
  assert.equal(confirmed.status, "REGISTERED");
  assert.equal(confirmed.invoice, null);
  assert.deepEqual(
    (
      await sql(
        'SELECT fields,"rawResult","rawText" FROM "TicketExtractedData" WHERE "ticketId"=$1',
        [ticket.id],
      )
    )[0],
    before,
  );
  pass(
    "editable review, changed-field labels, URL client/server validation, responsive/axe and confirmation use corrected data without overwriting raw OCR",
  );
  const duplicate = await upload();
  mode = "delay";
  const beforeCalls = calls;
  const analyses = await Promise.all([
    analyze(duplicate.id),
    analyze(duplicate.id),
  ]);
  assert.deepEqual(analyses.map((r) => r.status()).sort(), [200, 409]);
  assert.equal(calls - beforeCalls, 1);
  mode = "success";
  const confirmations = await Promise.all([
    post(a.context, `/api/tickets/${duplicate.id}/confirm`, confirmData),
    post(a.context, `/api/tickets/${duplicate.id}/confirm`, confirmData),
  ]);
  for (const response of confirmations) await json(response);
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*)::int AS n FROM "Expense" WHERE "ticketId"=$1',
        [duplicate.id],
      )
    )[0].n,
    1,
  );
  await json(await analyze(duplicate.id), 409);
  pass(
    "concurrent analyze and confirm create one OCR attempt and one expense; confirmed tickets cannot be reanalyzed",
  );
  const missing = await upload();
  mode = "missing";
  await json(await analyze(missing.id));
  const empty = await get(missing.id);
  assert.equal(empty.extractedData.fields.total, null);
  assert.equal(empty.extractedData.fields.date, null);
  assert.equal(empty.extractedData.confidence, null);
  assert(empty.extractedData.warnings.includes("MISSING_TOTAL"));
  pass("missing total/date remain null and confidence is never invented");
  const retry = await upload();
  mode = "failure";
  await json(await analyze(retry.id), 502);
  assert.equal((await get(retry.id)).status, "OCR_FAILED");
  await page.goto(`/dashboard/tickets/${retry.id}`);
  await expect(
    page.getByRole("button", { name: "Introducir datos manualmente" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Subir otra imagen" }),
  ).toBeVisible();
  mode = "success";
  await page.getByRole("button", { name: "Reintentar análisis" }).click();
  await expect(
    page.getByRole("heading", { name: "TICKET ANALIZADO" }),
  ).toBeVisible();
  assert.deepEqual(
    (
      await sql(
        'SELECT outcome FROM "TicketOcrAttempt" WHERE "ticketId"=$1 ORDER BY "startedAt"',
        [retry.id],
      )
    ).map((r) => r.outcome),
    ["OCR_FAILED", "REVIEW"],
  );
  const manual = await upload();
  mode = "failure";
  await json(await analyze(manual.id), 502);
  await json(
    await post(a.context, `/api/tickets/${manual.id}/confirm`, {
      ...confirmData,
      total: "0",
      subtotal: "0",
      tax: "0",
    }),
  );
  assert.equal((await get(manual.id)).expense.total, "0");
  pass(
    "failed OCR exposes retry/replacement/manual options; retry retains both attempts; manual zero-total confirmation works",
  );
  const stale = await upload();
  mode = "hold";
  const old = analyze(stale.id);
  await expect.poll(() => typeof release).toBe("function");
  await sql(
    'UPDATE "Ticket" SET "updatedAt"=NOW()-INTERVAL \'6 minutes\' WHERE id=$1',
    [stale.id],
  );
  mode = "success";
  await json(await analyze(stale.id));
  release();
  await json(await old, 409);
  assert.equal((await get(stale.id)).status, "REVIEW");
  assert.deepEqual(
    (
      await sql(
        'SELECT outcome FROM "TicketOcrAttempt" WHERE "ticketId"=$1 ORDER BY "startedAt"',
        [stale.id],
      )
    ).map((r) => r.outcome),
    ["SUPERSEDED", "REVIEW"],
  );
  pass(
    "expired analysis lease is replaced safely and a stale worker cannot overwrite the new result",
  );
  const foreignCurrency = await upload();
  await json(
    await post(a.context, `/api/tickets/${foreignCurrency.id}/confirm`, {
      ...confirmData,
      currency: "USD",
    }),
  );
  await json(
    await post(a.context, `/api/tickets/${foreignCurrency.id}/confirm`, {
      ...confirmData,
      currency: "USD",
    }),
  );
  assert.equal((await get(foreignCurrency.id)).expense, null);
  assert.equal((await get(foreignCurrency.id)).confirmedData.currency, "USD");
  pass(
    "foreign-currency ticket confirms idempotently without mixing dollars into MXN expenses",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/ticket-intelligence-e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        database: "ephemeral local PGlite; no Neon",
        provider: "local synthetic contract fixture, not real OCR",
      },
      null,
      2,
    ),
  );
  await a.context.close();
  await b.context.close();
} catch (error) {
  await writeFile("test-results/ticket-intelligence-server.log", logs);
  await writeFile(
    "test-results/ticket-intelligence-e2e-summary.json",
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  release?.();
  await browser?.close();
  app.kill();
  if (app.exitCode === null)
    await new Promise((resolve) => app.once("exit", resolve));
  await database.close();
  await new Promise((resolve) => ocr.close(resolve));
}
