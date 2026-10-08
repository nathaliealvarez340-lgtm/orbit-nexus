import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { startDatabase } from "./local-database.mjs";
import { LocalBillingAutomationRunner } from "../src/services/billing/local-runner.ts";

// The only portal is an in-memory fixture. All browser network requests are intercepted.
// No merchant is contacted, no real CFDI is issued, no production database is read.
const database = await startDatabase(),
  baseURL = "http://localhost:3202",
  origin = { Origin: baseURL };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const portal = "https://example.com/factura";
const fieldKeys = [
  "merchant",
  "issuerRfc",
  "ticketNumber",
  "folio",
  "operationNumber",
  "branch",
  "terminalNumber",
  "purchaseDate",
  "time",
  "total",
  "paymentMethod",
  "paymentReference",
  "billingReference",
  "rfc",
  "legalName",
  "fiscalRegime",
  "postalCode",
  "cfdiUse",
  "email",
  "street",
  "exteriorNumber",
  "interiorNumber",
  "colony",
  "locality",
  "municipality",
  "state",
  "country",
];
const manifest = {
  key: "controlled-fixture",
  portalUrl: portal,
  allowedHosts: ["example.com"],
  marker: "#fixture-form",
  fields: Object.fromEntries(
    fieldKeys.map((key) => [key, { selector: "#f_" + key, kind: "input" }]),
  ),
  submitSelector: "#issue",
  resultMarker: "#done",
  xmlLink: "#xml",
  pdfLink: "#pdf",
  requests: {
    prepare: [{ method: "GET", url: portal }],
    fill: [],
    submit: [{ method: "POST", url: "https://example.com/submit" }],
    collect: [
      { method: "GET", url: "https://example.com/result.xml" },
      { method: "GET", url: "https://example.com/result.pdf" },
    ],
  },
};
let mode = "success",
  submits = 0,
  prepared = 0,
  activeContext;
const uuids = new Map();
const pdf = await PDFDocument.create();
pdf.addPage();
const pdfBytes = Buffer.from(await pdf.save());
function xmlFor(context, change = {}) {
  if (!uuids.has(context.attemptId)) uuids.set(context.attemptId, randomUUID());
  const fields = Object.fromEntries(
    context.fields.map((f) => [f.key, f.value]),
  );
  const uuid = change.uuid || uuids.get(context.attemptId),
    receiver = change.receiver || fields.rfc,
    issuer = change.issuer || "AAA010101AAA",
    total = change.total || fields.total;
  return `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="2026-09-25T12:00:00" SubTotal="100.50" Total="${total}" Moneda="MXN" TipoDeComprobante="I"><cfdi:Emisor Rfc="${issuer}" Nombre="Fixture"/><cfdi:Receptor Rfc="${receiver}"/><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}"/></cfdi:Complemento></cfdi:Comprobante>`;
}
const runner = new LocalBillingAutomationRunner(
  browser,
  [manifest],
  async (url, options) => {
    if (url === portal)
      return {
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from(
          `<html lang="es"><head><title>Portal de prueba</title></head><body><form id="fixture-form" action="/submit" method="post">${fieldKeys.map((k) => `<label>${k}<input id="f_${k}" name="${k}"></label>`).join("")}<button id="issue">Emitir fixture</button></form></body></html>`,
        ),
      };
    if (url.endsWith("/submit") && options.method === "POST") {
      submits++;
      return {
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from(
          '<html><body><h1 id="done">Fixture recibido</h1><a id="xml" href="/result.xml">XML</a><a id="pdf" href="/result.pdf">PDF</a></body></html>',
        ),
      };
    }
    if (url.endsWith("/result.xml"))
      return {
        status: 200,
        headers: { "content-type": "application/xml" },
        body: Buffer.from(
          xmlFor(
            activeContext,
            mode === "rfc-mismatch"
              ? { receiver: "BBB010101BBB" }
              : mode === "total-mismatch"
                ? { total: "9.99" }
                : mode === "issuer-mismatch"
                  ? { issuer: "BBB010101BBB" }
                  : {},
          ),
        ),
      };
    if (url.endsWith("/result.pdf"))
      return {
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: pdfBytes,
      };
    throw new Error("Unlisted fixture request");
  },
);
const token = randomBytes(32).toString("hex");
const worker = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + token) {
    res.writeHead(403);
    res.end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const { action, context, sessionId, networkPolicy } = JSON.parse(body);
  assert.equal(networkPolicy, "orbit-public-pinned-v1");
  activeContext = context;
  if (action === "prepare") prepared++;
  if (mode === "portal-changed" && action === "fill") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ state: "MANUAL", errorCode: "PORTAL_CHANGED" }));
    return;
  }
  if (mode === "provider-fail" && action === "prepare") {
    res.writeHead(503);
    res.end();
    return;
  }
  let result = await runner.run(action, context, sessionId);
  if (mode === "ambiguous" && action === "submit") {
    res.writeHead(503);
    res.end();
    return;
  }
  if (mode === "no-evidence" && action === "collect")
    result = { state: "RESULT", uuid: randomUUID() };
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(result));
});
await new Promise((resolve) => worker.listen(0, "127.0.0.1", resolve));
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3202",
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
      OCR_API_URL: "",
      OCR_API_TOKEN: "",
      MAIL_API_URL: "",
      MAIL_API_TOKEN: "",
      BILLING_AUTOMATION_URL: `http://127.0.0.1:${worker.address().port}`,
      BILLING_AUTOMATION_TOKEN: token,
      BILLING_AUTOMATION_ADAPTERS: "controlled-fixture",
    },
  },
);
let logs = "";
app.stdout.on("data", (b) => (logs += b));
app.stderr.on("data", (b) => (logs += b));
const checks = [],
  errors = [];
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
const post = (ctx, path, data = {}) =>
  ctx.request.post(path, { headers: origin, data });
const account = async (name) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  const user = (
    await json(
      await post(context, "/api/auth/sign-up/email", {
        name,
        email: name + "@example.test",
        password: `Synthetic-${randomBytes(18).toString("hex")}-9aZ`,
      }),
    )
  ).user;
  const org = await json(
    await post(context, "/api/organizations", { name }),
    201,
  );
  return { context, org, user };
};
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/billing-e2e-summary.json",
  JSON.stringify({ passed: false }),
);
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
    if (Date.now() > deadline) throw new Error("Local server failed");
    await new Promise((r) => setTimeout(r, 250));
  }
  const a = await account("BillingA"),
    b = await account("BillingB"),
    anon = await browser.newContext({ baseURL });
  const page = await a.context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await sql(
    `INSERT INTO "Company" (id,slug,name,"merchantRfc",domain,"portalUrl",compatibility,"automationMode","adapterKey","requiredFields",rules,"updatedAt") VALUES ('fixture','controlled-fixture','Fixture','AAA010101AAA','example.com',$1,'AUTOMATIC','AUTOMATED','controlled-fixture','["ticketNumber"]','{}',NOW())`,
    [portal],
  );
  const png = await sharp({
    create: { width: 50, height: 50, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const newTicket = async (extra = {}) => {
    await sql('DELETE FROM "RequestLimit"');
    const t = await json(
      await a.context.request.post("/api/tickets", {
        headers: origin,
        multipart: {
          file: { name: "fixture.png", mimeType: "image/png", buffer: png },
        },
      }),
      201,
    );
    await json(
      await post(a.context, `/api/tickets/${t.id}/confirm`, {
        merchant: "Fixture",
        issuerRfc: "AAA010101AAA",
        purchaseDate: "2026-09-20",
        total: "100.50",
        ticketNumber: "TC-" + t.id,
        currency: "MXN",
        billingUrl: portal,
        ...extra,
      }),
    );
    return t;
  };
  const prepare = (t, extra = {}) =>
    post(a.context, `/api/tickets/${t.id}/billing`, {
      companyId: "fixture",
      confirmedPortal: true,
      ...extra,
    });
  const action = (ctx, id, act, data = {}) =>
    post(ctx, `/api/billing-attempts/${id}/${act}`, data);
  const history = async (t) =>
    json(await a.context.request.get(`/api/tickets/${t.id}/billing`));
  const first = await newTicket();
  await json(await anon.request.get(`/api/tickets/${first.id}/billing`), 401);
  await json(
    await b.context.request.get(`/api/tickets/${first.id}/billing`),
    404,
  );
  await json(
    await post(b.context, `/api/tickets/${first.id}/billing`, {
      companyId: "fixture",
      confirmedPortal: true,
    }),
    404,
  );
  const incomplete = await json(await prepare(first));
  assert.equal(incomplete.errorCode, "PROFILE_INCOMPLETE");
  assert.equal(prepared, 0);
  assert.equal(submits, 0);
  await sql(
    `INSERT INTO "Document" (id,"organizationId","uploadedById",kind,"fileName","mimeType",size,content,sha256) VALUES ('csf-fixture',$1,$2,'FISCAL_CSF','csf.pdf','application/pdf',$3,$4,$5)`,
    [
      a.org.id,
      a.user.id,
      pdfBytes.length,
      pdfBytes,
      createHash("sha256").update(pdfBytes).digest("hex"),
    ],
  );
  await sql(
    `INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,street,"exteriorNumber",colony,locality,municipality,state,country,"csfDocumentId","confirmedAt","updatedAt") VALUES ('fiscal',$1,$2,'XAXX010101000','Empresa Fixture','601','01000','G03','fiscal@example.test','Calle','1','Centro','Ciudad','Municipio','Estado','MEX','csf-fixture',NOW(),NOW())`,
    [a.user.id, a.org.id],
  );
  pass(
    "tenant-only portal listing/prepare; incomplete fiscal profile stops before any runner call",
  );
  const two = await Promise.all([prepare(first), prepare(first)]);
  for (const r of two) await json(r);
  let attempt = (await history(first)).attempts[0];
  assert.equal(attempt.status, "AWAITING_APPROVAL");
  assert.equal(submits, 0);
  assert.equal(prepared, 1);
  assert(
    attempt.fields.some(
      (f) =>
        f.key === "rfc" &&
        f.source === "FISCAL_PROFILE" &&
        f.value === "XAXX010101000",
    ),
  );
  const raw = JSON.stringify(await history(first));
  assert(!raw.includes("approvalHash"));
  assert(!raw.includes("remoteSession"));
  assert(!raw.includes(token));
  await json(await action(b.context, attempt.id, "review"), 404);
  await json(await action(b.context, attempt.id, "cancel"), 404);
  await json(await action(b.context, attempt.id, "collect"), 404);
  await json(
    await action(a.context, attempt.id, "submit", {
      approvalToken: randomBytes(32).toString("hex"),
    }),
    403,
  );
  const approval = await json(await action(a.context, attempt.id, "review"));
  await sql(
    'UPDATE "BillingAttempt" SET "approvalExpiresAt"=NOW()-INTERVAL \'1 minute\' WHERE id=$1',
    [attempt.id],
  );
  await json(
    await action(a.context, attempt.id, "submit", {
      approvalToken: approval.approvalToken,
    }),
    409,
  );
  assert.equal(submits, 0);
  await sql(
    "UPDATE \"FiscalProfile\" SET email='changed@example.test' WHERE id='fiscal'",
  );
  await json(await action(a.context, attempt.id, "review"), 409);
  await sql(
    "UPDATE \"FiscalProfile\" SET email='fiscal@example.test' WHERE id='fiscal'",
  );
  pass(
    "one concurrent preparation; verified autofill; foreign/wrong/expired approval and changed fiscal data blocked; no submit before approval",
  );
  await page.goto(`/dashboard/tickets/${first.id}`);
  const reject = page.getByRole("button", { name: "Rechazar no esenciales" });
  if (await reject.isVisible()) await reject.click();
  await expect(
    page.getByRole("heading", { name: "Factura preparada", exact: true }),
  ).toBeVisible();
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
    path: "test-results/billing-review-360.png",
    fullPage: true,
  });
  const [reviewResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/" + attempt.id + "/review")),
    page.getByRole("button", { name: "He revisado los datos" }).click(),
  ]);
  await expect(
    page.getByRole("button", { name: "Confirmar y facturar" }),
  ).toBeVisible();
  assert.equal(submits, 0);
  // Capture a closed report before obtaining the invoice: totals must remain unchanged afterwards.
  const reports = await json(await a.context.request.get("/api/reports"));
  const report = reports.find((r) => r.year === 2026 && r.month === 9);
  assert(report);
  const finalApproval = await reviewResponse.json();
  const [submittedResponse, , duplicateResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/" + attempt.id + "/submit")),
    page.getByRole("button", { name: "Confirmar y facturar" }).click(),
    action(a.context, attempt.id, "submit", {
      approvalToken: finalApproval.approvalToken,
    }),
  ]);
  assert.equal(submittedResponse.status(), 200);
  await json(duplicateResponse);
  assert.equal(submits, 1);
  assert.equal((await history(first)).attempts[0].status, "WAITING_PROVIDER");
  assert.equal((await sql('SELECT COUNT(*)::int n FROM "Invoice"'))[0].n, 0);
  await json(await action(a.context, attempt.id, "collect"));
  attempt = (await history(first)).attempts[0];
  assert.equal(attempt.status, "SUCCEEDED");
  assert(attempt.invoice.uuid);
  await json(
    await action(a.context, attempt.id, "submit", {
      approvalToken: finalApproval.approvalToken,
    }),
  );
  await json(await action(a.context, attempt.id, "collect"));
  assert.equal(submits, 1);
  const ticket = await json(
    await a.context.request.get(`/api/tickets/${first.id}`),
  );
  assert.equal(ticket.status, "INVOICED");
  assert.equal(ticket.expense.total, "100.5");
  assert.equal(ticket.expense.billingStatus, "INVOICED");
  assert.equal(
    (
      await sql('SELECT COUNT(*)::int n FROM "Expense" WHERE "ticketId"=$1', [
        first.id,
      ])
    )[0].n,
    1,
  );
  assert.equal(
    (await sql('SELECT COUNT(*)::int n FROM "StampedInvoice"'))[0].n,
    0,
  );
  for (const doc of [
    attempt.invoice.xmlDocumentId,
    attempt.invoice.pdfDocumentId,
  ]) {
    await json(await b.context.request.get("/api/documents/" + doc), 404);
    assert.equal(
      (await a.context.request.get("/api/documents/" + doc)).status(),
      200,
    );
  }
  const exported = await a.context.request.get(
    `/api/reports/${report.id}?format=xlsx`,
  );
  assert.equal(exported.status(), 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exported.body());
  assert(JSON.stringify(book.model).includes(attempt.invoice.uuid));
  const closed = (
    await sql(
      'SELECT total,"ticketCount" FROM "MonthlyExpenseReport" WHERE id=$1',
      [report.id],
    )
  )[0];
  assert.equal(Number(closed.total), 100.5);
  assert.equal(closed.ticketCount, 1);
  const notices = await json(await a.context.request.get("/api/notifications"));
  assert(notices.some((n) => n.type === "BILLING_PREPARED"));
  assert(notices.some((n) => n.type === "INVOICE_COMPLETED"));
  pass(
    "responsive/axe approval UI; one submit; pending is not success; XML/PDF private; UUID enriches closed report without duplicating expense or changing sales",
  );
  const manual = await newTicket({
    merchant: "Unknown",
    issuerRfc: "",
    billingUrl: "https://example.org/portal",
  });
  const custom = await json(
    await prepare(manual, {
      companyId: undefined,
      url: "https://example.org/portal",
      name: "Proveedor propio",
      favorite: true,
    }),
  );
  assert.equal(custom.status, "NEEDS_MANUAL_ACTION");
  assert.equal(custom.errorCode, "UNSUPPORTED_PROVIDER");
  const own = (await history(manual)).frequent.find(
    (p) => p.name === "Proveedor propio",
  );
  assert(own);
  assert.equal(
    (
      await sql(
        "SELECT COUNT(*)::int n FROM \"Company\" WHERE name='Proveedor propio'",
      )
    )[0].n,
    0,
  );
  const bt = await post(b.context, `/api/tickets/${manual.id}/billing`, {
    providerId: own.id,
    confirmedPortal: true,
  });
  await json(bt, 404);
  await json(
    await a.context.request.post(`/api/tickets/${manual.id}/invoice-document`, {
      headers: origin,
      multipart: {
        xml: {
          name: "invoice.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(
            xmlFor({
              attemptId: "manual",
              fields: [
                { key: "rfc", value: "XAXX010101000" },
                { key: "total", value: "100.50" },
              ],
            }),
          ),
        },
        confirmed: "true",
      },
    }),
    201,
  );
  assert.equal(
    (await json(await a.context.request.get(`/api/tickets/${manual.id}`)))
      .billingStatus,
    "INVOICED",
  );
  pass(
    "unknown provider remains manual and tenant-scoped; private manual XML import completes original expense",
  );
  for (const failureMode of ["portal-changed", "provider-fail"]) {
    mode = failureMode;
    const t = await newTicket();
    const a1 = await json(await prepare(t));
    assert.equal(a1.status, "NEEDS_MANUAL_ACTION");
    assert.equal(
      a1.errorCode,
      failureMode === "portal-changed" ? "PORTAL_CHANGED" : "PROVIDER_ERROR",
    );
  }
  mode = "success";
  const cancelled = await newTicket();
  const c = await json(await prepare(cancelled));
  await json(await action(a.context, c.id, "cancel"));
  await json(await action(a.context, c.id, "review"), 409);
  pass(
    "changed portal, failed provider and cancellation stop safely without guessing fields",
  );
  for (const resultMode of [
    "ambiguous",
    "no-evidence",
    "rfc-mismatch",
    "total-mismatch",
    "issuer-mismatch",
  ]) {
    mode = "success";
    const t = await newTicket();
    const a1 = await json(await prepare(t));
    const approval1 = await json(await action(a.context, a1.id, "review"));
    mode = resultMode;
    const before = submits;
    await json(
      await action(a.context, a1.id, "submit", {
        approvalToken: approval1.approvalToken,
      }),
    );
    if (resultMode !== "ambiguous")
      await json(await action(a.context, a1.id, "collect"));
    const failed = (await history(t)).attempts[0];
    assert.equal(failed.status, "NEEDS_MANUAL_ACTION");
    assert.equal(
      (
        await sql('SELECT COUNT(*)::int n FROM "Invoice" WHERE "ticketId"=$1', [
          t.id,
        ])
      )[0].n,
      0,
    );
    await json(
      await action(a.context, a1.id, "submit", {
        approvalToken: approval1.approvalToken,
      }),
    );
    const again = await json(await prepare(t));
    assert.equal(again.id, a1.id);
    assert.equal(submits, before + 1);
    if (resultMode === "ambiguous") {
      assert.equal(failed.errorCode, "SUBMIT_AMBIGUOUS");
      mode = "success";
      await json(await action(a.context, a1.id, "collect"));
      assert.equal((await history(t)).attempts[0].status, "SUCCEEDED");
      assert.equal(submits, before + 1);
    }
  }
  pass(
    "ambiguous submit never retries; collection can recover; UUID alone, wrong issuer/receiver/total never mark success",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/billing-e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        submits,
        realMerchantsContacted: 0,
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile("test-results/billing-server.log", logs);
  throw error;
} finally {
  await runner.close();
  await browser.close();
  await new Promise((r) => worker.close(r));
  app.kill();
  await new Promise((r) => (app.exitCode !== null ? r() : app.once("exit", r)));
  await database.close();
}
