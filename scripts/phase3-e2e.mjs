import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import sharp from "sharp";
import AxeBuilder from "@axe-core/playwright";
import { startDatabase } from "./local-database.mjs";

// All SQL, including issued-invoice fixtures and plan changes, targets ephemeral PGlite.
const database = await startDatabase(),
  port = 3199,
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
let logs = "",
  browser;
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
async function json(response, status = 200) {
  assert.equal(
    response.status(),
    status,
    `Expected ${status}: ${await response.text()}`,
  );
  return response.json();
}
const post = (context, path, data) =>
  context.request.post(path, { headers: origin, data });
const credential = () =>
  "Synthetic-" + randomBytes(18).toString("hex") + "-9aZ";
async function account(name) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const password = credential(),
    email = `${name.toLowerCase()}@example.test`;
  const user = (
    await json(
      await post(context, "/api/auth/sign-up/email", { name, email, password }),
    )
  ).user;
  const org = await json(
    await post(context, "/api/organizations", { name: "Empresa " + name }),
    201,
  );
  return { context, user, org, password, email };
}
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/phase3-e2e-summary.json",
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
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const a = await account("PhaseThreeA"),
    b = await account("PhaseThreeB"),
    anon = await browser.newContext({ baseURL });
  const page = await a.context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dashboard");
  const reject = page.getByRole("button", { name: "Rechazar no esenciales" });
  if (await reject.isVisible()) await reject.click();
  for (const path of [
    "/api/clients",
    "/api/reports",
    "/api/notifications",
    "/api/outgoing-invoices",
    "/api/outgoing-invoices/settings",
  ])
    await json(await anon.request.get(path), 401);
  await json(
    await post(anon, "/api/user/preferences", { accent: "BLUE" }),
    401,
  );
  assert.equal(
    (
      await sql(
        'SELECT role FROM "Membership" WHERE "organizationId"=$1 AND "userId"=$2',
        [a.org.id, a.user.id],
      )
    )[0].role,
    "OWNER",
  );
  pass(
    "new private APIs require a real session; organization creates OWNER membership",
  );

  for (const path of [
    "/api/outgoing-invoices",
    "/api/outgoing-invoices/settings",
  ]) {
    await json(await a.context.request.get(path), 403);
    await json(await post(a.context, path, {}), 403);
  }
  await page.goto("/dashboard/invoices/new");
  await expect(
    page.getByRole("heading", { name: "Facturas · PRO / MAX" }),
  ).toBeVisible();
  for (const path of ["/dashboard/tickets", "/dashboard/invoices"]) {
    await page.goto(path);
    assert.equal(
      await page.getByText("Facturas · PRO / MAX", { exact: true }).count(),
      0,
    );
  }
  await sql(
    'INSERT INTO "Subscription" ("organizationId",plan,"updatedAt") VALUES ($1,\'PRO\',NOW()),($2,\'MAX\',NOW())',
    [a.org.id, b.org.id],
  );
  await json(await a.context.request.get("/api/outgoing-invoices/settings"));
  await json(await b.context.request.get("/api/outgoing-invoices/settings"));
  pass(
    "FREE cannot access invoice services or pages; PRO and MAX can; incoming CFDI stays available",
  );

  const clientData = {
    rfc: "BBB010101BBB",
    legalName: "Cliente de prueba",
    personType: "COMPANY",
    fiscalRegime: "601",
    cfdiUse: "G03",
    email: "client@example.test",
    postalCode: "06000",
    defaultPaymentForm: "03",
    street: "Prueba",
    exteriorNumber: "1",
    colony: "Centro",
    locality: "Ciudad",
    municipality: "Municipio",
    state: "Estado",
    country: "MEX",
    additionalEmails: ["second@example.test"],
  };
  const client = await json(
    await post(a.context, "/api/clients", {
      ...clientData,
      organizationId: b.org.id,
    }),
    201,
  );
  assert.equal(client.organizationId, a.org.id);
  await json(
    await b.context.request.patch("/api/clients/" + client.id, {
      headers: origin,
      data: clientData,
    }),
    404,
  );
  await json(
    await b.context.request.delete("/api/clients/" + client.id, {
      headers: origin,
    }),
    404,
  );
  assert.equal(
    (await json(await b.context.request.get("/api/clients"))).length,
    0,
  );
  await json(
    await a.context.request.patch("/api/clients/" + client.id, {
      headers: { Origin: "https://foreign.example.test" },
      data: clientData,
    }),
    403,
  );
  await page.goto("/dashboard/clients");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page
    .getByLabel("Nombre / razón social", { exact: true })
    .fill("Cliente actualizado UI");
  await page
    .getByRole("button", { name: "Guardar cliente", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Cliente guardado");
  pass(
    "client create/update is real, ignores client tenant IDs, blocks foreign access and bad origins",
  );

  const fiscal = {
    ...clientData,
    rfc: "AAA010101AAA",
    legalName: "Emisor de prueba",
    email: "fiscal@example.test",
    confirmed: true,
  };
  await json(await post(a.context, "/api/fiscal-profile", fiscal));
  const draft = {
    clientId: client.id,
    invoiceDate: "2026-08-15",
    documentType: "I",
    cfdiUse: "G03",
    paymentForm: "03",
    paymentMethod: "PUE",
    currency: "MXN",
    concepts: [
      {
        description: "Servicio decimal",
        productCode: "01010101",
        unitCode: "ACT",
        quantity: "2.5",
        unitPrice: "12.34",
        taxRate: "0.16",
      },
      {
        description: "Ajuste",
        productCode: "01010101",
        unitCode: "ACT",
        quantity: "3",
        unitPrice: "0.10",
        taxRate: "0.16",
      },
    ],
  };
  await json(await post(a.context, "/api/outgoing-invoices", draft), 409);
  await page.goto("/dashboard/fiscal-profile");
  await expect(
    page.getByText(
      "Perfil incompleto · Completa la dirección y adjunta la constancia PDF",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(await page.locator('select[name="cfdiUse"]').count(), 1);
  assert.equal(await page.locator('input[name="cfdiUse"]').count(), 0);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage().drawText("SYNTHETIC CSF FOR LOCAL TEST ONLY");
  const pdf = Buffer.from(await pdfDoc.save());
  const upload = (context, kind, name, mimeType, buffer) =>
    context.request.post("/api/private-assets", {
      headers: origin,
      multipart: { kind, file: { name, mimeType, buffer } },
    });
  await json(
    await upload(
      a.context,
      "CSF",
      "fake.pdf",
      "application/pdf",
      Buffer.from("not pdf"),
    ),
    400,
  );
  const csf = await json(
    await upload(a.context, "CSF", "test-csf.pdf", "application/pdf", pdf),
    201,
  );
  await json(
    await post(b.context, "/api/fiscal-profile", {
      ...fiscal,
      csfDocumentId: csf.id,
    }),
    404,
  );
  await json(await b.context.request.get("/api/documents/" + csf.id), 404);
  await json(
    await post(a.context, "/api/fiscal-profile", {
      ...fiscal,
      csfDocumentId: csf.id,
    }),
  );
  await page.reload();
  await expect(
    page.getByText("Perfil completo · Constancia y dirección registradas", {
      exact: true,
    }),
  ).toBeVisible();
  const privateFile = await a.context.request.get("/api/documents/" + csf.id);
  assert.equal(privateFile.status(), 200);
  assert.match(privateFile.headers()["cache-control"], /no-store/);
  pass(
    "fiscal profile validates catalog and address, requires real private CSF PDF for completeness, blocks cross-tenant document assignment",
  );

  const opaque = await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  await json(
    await upload(a.context, "INVOICE_LOGO", "opaque.png", "image/png", opaque),
    400,
  );
  const transparent = await sharp({
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
    await upload(
      a.context,
      "INVOICE_LOGO",
      "logo.png",
      "image/png",
      transparent,
    ),
    201,
  );
  await json(
    await post(b.context, "/api/outgoing-invoices/settings", {
      prefix: "ORB",
      color: "#3b82f6",
      template: "CLASSIC",
      logoDocumentId: logo.id,
    }),
    400,
  );
  await json(
    await post(a.context, "/api/outgoing-invoices/settings", {
      prefix: "ORB",
      color: "#3b82f6",
      template: "CLASSIC",
      logoDocumentId: logo.id,
      nextNumber: 900,
    }),
  );
  const created = await Promise.all([
    post(a.context, "/api/outgoing-invoices", {
      ...draft,
      total: "999",
      status: "ISSUED",
      organizationId: b.org.id,
    }),
    post(a.context, "/api/outgoing-invoices", draft),
  ]);
  const drafts = await Promise.all(created.map((r) => json(r, 201)));
  assert.deepEqual(drafts.map((d) => d.folio).sort(), [
    "ORB-000001",
    "ORB-000002",
  ]);
  const details = await json(
    await a.context.request.get("/api/outgoing-invoices/" + drafts[0].id),
  );
  assert.equal(details.status, "DRAFT");
  assert.equal(details.uuid, null);
  assert.equal(details.subtotal, "31.15");
  assert.equal(details.tax, "4.99");
  assert.equal(details.total, "36.14");
  await sql(
    'UPDATE "Subscription" SET plan=\'FREE\' WHERE "organizationId"=$1',
    [a.org.id],
  );
  await json(
    await a.context.request.get("/api/outgoing-invoices/" + drafts[0].id),
    403,
  );
  await json(await a.context.request.get("/api/documents/" + logo.id), 403);
  assert.equal(
    (await a.context.request.get("/api/documents/" + csf.id)).status(),
    200,
  );
  await sql(
    'UPDATE "Subscription" SET plan=\'PRO\' WHERE "organizationId"=$1',
    [a.org.id],
  );
  assert.equal(
    (await json(await a.context.request.get("/api/outgoing-invoices"))).length,
    0,
  );
  await json(
    await b.context.request.get("/api/outgoing-invoices/" + drafts[0].id),
    404,
  );
  await page.goto("/dashboard/invoices/drafts/" + drafts[0].id);
  await expect(
    page.getByText("Timbrado pendiente de integración PAC.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Cliente actualizado UI", { exact: true }),
  ).toBeVisible();
  await page.goto("/dashboard/invoices/new");
  await page
    .getByLabel("Descripción", { exact: true })
    .fill("Concepto creado por UI");
  await page.getByLabel("Precio unitario", { exact: true }).fill("100.00");
  await page.getByRole("button", { name: "Guardar y ver borrador" }).click();
  await expect(page).toHaveURL(/\/dashboard\/invoices\/drafts\//);
  await expect(
    page.getByText("Concepto creado por UI", { exact: true }),
  ).toBeVisible();
  pass(
    "transparent logo and tenant settings validated; concurrent drafts allocate unique atomic folios, exact decimals and immutable client snapshots; no fake issuance",
  );

  const today = new Date(),
    priorMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15),
    ),
    date = priorMonth.toISOString().slice(0, 10),
    year = priorMonth.getUTCFullYear();
  for (const [id, amount] of [
    ["expense-one", "123.45"],
    ["expense-two", "80.50"],
  ]) {
    await sql(
      'INSERT INTO "Ticket" (id,"organizationId","userId","fileName","storageKey","mimeType",status,"updatedAt") VALUES ($1,$2,$3,\'synthetic.png\',\'local-test\',\'image/png\',\'REGISTERED\',NOW())',
      [id, a.org.id, a.user.id],
    );
    await sql(
      'INSERT INTO "Expense" (id,"organizationId","ticketId","capturedById",merchant,"purchaseDate",total,details) VALUES ($1,$2,$1,$3,\'Comercio local prueba\',$4,$5,$6)',
      [id, a.org.id, a.user.id, date, amount, { issuerRfc: "CCC010101CCC" }],
    );
  }
  await sql(
    'INSERT INTO "Invoice" (id,"organizationId","userId","ticketId",status,"receiverRfc",subtotal,tax,total,"updatedAt",uuid) VALUES (\'incoming-fixture\',$1,$2,\'expense-two\',\'ISSUED\',\'AAA010101AAA\',80.50,0,80.50,NOW(),$3)',
    [a.org.id, a.user.id, randomUUID()],
  );
  await sql(
    "UPDATE \"Expense\" SET \"billingStatus\"='INVOICED' WHERE id='expense-two'",
  );
  const reportResponses = await Promise.all([
    a.context.request.get("/api/reports"),
    a.context.request.get("/api/reports"),
  ]);
  const reports = await json(reportResponses[0]);
  await json(reportResponses[1]);
  const report = reports.find(
    (r) => r.year === year && r.month === priorMonth.getUTCMonth() + 1,
  );
  assert(report);
  assert.equal(report.total, "203.95");
  assert.equal(report.ticketCount, 2);
  assert.equal(report.invoiceCount, 1);
  assert.equal(report.pendingCount, 1);
  assert(
    !reports.some(
      (r) =>
        r.year === today.getUTCFullYear() &&
        r.month === today.getUTCMonth() + 1,
    ),
  );
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*)::int AS n FROM "MonthlyExpenseReport" WHERE "organizationId"=$1',
        [a.org.id],
      )
    )[0].n,
    reports.length,
  );
  for (const format of ["pdf", "xlsx"]) {
    await json(
      await b.context.request.get(`/api/reports/${report.id}?format=${format}`),
      404,
    );
    const response = await a.context.request.get(
      `/api/reports/${report.id}?format=${format}`,
    );
    assert.equal(response.status(), 200);
    const content = await response.body();
    await writeFile(`test-results/phase3-report.${format}`, content);
    if (format === "pdf")
      assert((await PDFDocument.load(content)).getPageCount() > 0);
    else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(content);
      assert.equal(
        workbook.getWorksheet("Resumen").getCell("B5").value,
        203.95,
      );
      assert.equal(
        workbook.getWorksheet("Detalle").getCell("F2").value,
        123.45,
      );
      assert.equal(workbook.getWorksheet("Detalle").rowCount, 3);
    }
  }
  pass(
    "concurrent monthly closure is unique, excludes current month, totals only tenant expenses; PDF and two-sheet XLSX parse with exact values; foreign downloads denied",
  );

  // These are test-only fixtures representing imported, genuinely issued invoices, not an application issuance API.
  await sql(
    'UPDATE "StampedInvoice" SET status=\'ISSUED\',uuid=$1,"issuedAt"=$2,total=250,subtotal=250,tax=0 WHERE id=$3',
    [randomUUID(), priorMonth.toISOString(), drafts[0].id],
  );
  await sql(
    "INSERT INTO \"StampedInvoice\" (id,\"organizationId\",\"userId\",status,uuid,\"issuedAt\",currency,\"issuerRfc\",\"receiverRfc\",subtotal,tax,total,\"updatedAt\") VALUES ('usd-fixture',$1,$2,'ISSUED',$3,$4,'USD','AAA010101AAA','BBB010101BBB',999,0,999,NOW()),('tenant-b-fixture',$5,$6,'ISSUED',$7,$4,'MXN','AAA010101AAA','BBB010101BBB',9999,0,9999,NOW())",
    [
      a.org.id,
      a.user.id,
      randomUUID(),
      priorMonth.toISOString(),
      b.org.id,
      b.user.id,
      randomUUID(),
    ],
  );
  await page.goto("/dashboard?year=" + year);
  await expect(
    page.getByText("$203.95", { exact: true }).first(),
  ).toBeVisible();
  const metrics = page.getByRole("region", {
    name: "Métricas de facturación emitida",
  });
  await expect(metrics.getByText("$250.00", { exact: true })).toBeVisible();
  await expect(metrics.getByText("$9,999.00", { exact: true })).toHaveCount(0);
  await page.goto(`/dashboard?year=${year}&currency=USD`);
  await expect(metrics.getByText(/999\.00/).first()).toBeVisible();
  await page.goto(`/dashboard?year=${year - 1}`);
  await expect(
    metrics.getByText("$0.00", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/dashboard/invoices/issued");
  await expect(page.getByText(drafts[1].folio, { exact: true })).toHaveCount(0);
  pass(
    "dashboard separates expenses/incoming CFDI from issued income, excludes drafts/other tenants, isolates currencies and filters years; issued list excludes drafts",
  );

  await json(
    await a.context.request.delete("/api/clients/" + client.id, {
      headers: origin,
    }),
  );
  assert.equal(
    (await json(await a.context.request.get("/api/clients"))).length,
    0,
  );
  assert.equal(
    (await json(await a.context.request.get("/api/clients?archived=true")))
      .length,
    1,
  );
  assert.equal(
    (
      await json(
        await a.context.request.get("/api/outgoing-invoices/" + drafts[1].id),
      )
    ).receiverSnapshot.legalName,
    "Cliente actualizado UI",
  );
  await json(await post(a.context, "/api/outgoing-invoices", draft), 404);
  pass(
    "archiving clients preserves document snapshots and prevents new drafts for archived clients",
  );

  await sql(
    "INSERT INTO \"ActivityLog\" (id,\"organizationId\",\"userId\",action,\"entityType\",\"entityId\") VALUES ('event-ticket',$1,$2,'TICKET_ANALYZED','Ticket','expense-one'),('event-expense',$1,$2,'EXPENSE_CONFIRMED','Expense','expense-one'),('event-invoice',$1,$2,'INVOICE_COMPLETED','Invoice','incoming-fixture')",
    [a.org.id, a.user.id],
  );
  const notices = await json(await a.context.request.get("/api/notifications"));
  for (const type of [
    "REPORT_AVAILABLE",
    "TICKET_ANALYZED",
    "EXPENSE_CONFIRMED",
    "INVOICE_COMPLETED",
  ])
    assert(notices.some((n) => n.type === type));
  await json(
    await post(b.context, "/api/notifications", { id: notices[0].id }),
    404,
  );
  await json(
    await post(a.context, "/api/notifications", { id: notices[0].id }),
  );
  await sql(
    'INSERT INTO "Membership" (id,"organizationId","userId",role) VALUES (\'member-test\',$1,$2,\'MEMBER\')',
    [a.org.id, b.user.id],
  );
  await json(
    await post(b.context, "/api/organizations/active", {
      organizationId: a.org.id,
    }),
  );
  assert(
    (await json(await b.context.request.get("/api/notifications"))).every(
      (n) => n.reads.length === 0,
    ),
  );
  await json(await post(b.context, "/api/fiscal-profile", fiscal), 403);
  await json(
    await post(b.context, "/api/outgoing-invoices/settings", {
      prefix: "ORB",
      color: "#3b82f6",
      template: "CLASSIC",
      logoDocumentId: logo.id,
    }),
    403,
  );
  await json(await post(a.context, "/api/notifications", {}));
  assert(
    (await json(await a.context.request.get("/api/notifications"))).every(
      (n) => n.reads.length === 1,
    ),
  );
  await json(
    await post(b.context, "/api/organizations/active", {
      organizationId: b.org.id,
    }),
  );
  pass(
    "notifications cover business events; one/all reads persist per user; MEMBER cannot change fiscal data or invoice settings",
  );

  await page.goto("/dashboard/user");
  await page.getByLabel("Color de acento").selectOption("BLUE");
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Preferencias guardadas",
  );
  await page.reload();
  assert.equal(
    await page
      .locator(".orbit-app")
      .evaluate((e) =>
        getComputedStyle(e).getPropertyValue("--orbit-accent").trim(),
      ),
    "#3b82f6",
  );
  const newPassword = credential();
  await page.getByLabel("Contraseña actual", { exact: true }).fill(a.password);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Confirmar nueva contraseña", { exact: true })
    .fill(newPassword);
  await page
    .getByRole("button", { name: "Mostrar contraseña", exact: true })
    .first()
    .click();
  assert.equal(
    await page.locator('input[name="current"]').getAttribute("type"),
    "text",
  );
  await page.getByRole("button", { name: "Actualizar contraseña" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Contraseña actualizada",
  );
  await json(
    await post(anon, "/api/auth/sign-in/email", {
      email: a.email,
      password: a.password,
    }),
    401,
  );
  await json(
    await post(anon, "/api/auth/sign-in/email", {
      email: a.email,
      password: newPassword,
    }),
  );
  pass(
    "user accent survives refresh; password visibility works; Better Auth changes password and rejects old credentials",
  );

  await page.goto("/dashboard/support");
  await page.getByLabel("Buscar ayuda").fill("contraseña");
  await expect(
    page.getByRole("heading", { name: "Actualizar contraseña y preferencias" }),
  ).toBeVisible();
  const routes = [
    "/dashboard",
    "/dashboard/reports",
    "/dashboard/companies",
    "/dashboard/fiscal-profile",
    "/dashboard/user",
    "/dashboard/invoices/new",
    "/dashboard/invoices/settings",
    "/dashboard/invoices/issued",
    "/dashboard/clients",
    "/dashboard/notifications",
    "/dashboard/support",
    "/dashboard/tickets",
  ];
  for (const width of [1440, 1280, 820, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      const response = await page.goto(route);
      assert.equal(response.status(), 200, route);
      await expect(page.locator("main h1")).toBeVisible();
      if (route === "/dashboard/clients") {
        await page
          .getByRole("button", { name: "Nuevo cliente", exact: true })
          .click();
        await expect(
          page.getByLabel("Nombre / razón social", { exact: true }),
        ).toBeVisible();
      }
      if (route === "/dashboard")
        await expect(
          page.getByRole("img", {
            name: "Gastos confirmados por mes en pesos mexicanos",
          }),
        ).toBeVisible();
      if (width === 1440) {
        const accessibility = await new AxeBuilder({ page })
          .include(".orbit-app")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          accessibility.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
          [],
          route + " accessibility",
        );
      }
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${route}: overflow at ${width}`,
      );
      if (width === 390) {
        const tables = page.locator('[role="region"][aria-label^="Tabla"]');
        for (const table of await tables.all())
          if (await table.evaluate((e) => e.scrollWidth > e.clientWidth)) {
            await table.focus();
            await page.keyboard.press("ArrowRight");
            await expect
              .poll(() => table.evaluate((e) => e.scrollLeft))
              .toBeGreaterThan(0);
          }
      }
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: `test-results/phase3-${route.replaceAll("/", "-")}-${width}.png`,
          fullPage: true,
        });
    }
    if (width < 1024) {
      await page.getByRole("button", { name: "Abrir menú" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("link", { name: "Reportes", exact: true }),
      ).toBeVisible();
      const section = dialog
        .locator("summary")
        .filter({ hasText: "ADMINISTRACIÓN" });
      await section.focus();
      await page.keyboard.press("Enter");
      await expect(
        dialog.getByRole("link", { name: "Empresas", exact: true }),
      ).not.toBeVisible();
      await page.keyboard.press("Enter");
      await expect(
        dialog.getByRole("link", { name: "Empresas", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
    }
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: "Gastos confirmados por mes en pesos mexicanos",
      }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/phase3-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  pass(
    "support search and all new private pages render at desktop/laptop/tablet/mobile widths; mobile dialog is keyboard accessible; no browser errors",
  );
  await json(
    await post(a.context, "/api/organizations", { name: "Segunda empresa UI" }),
    201,
  );
  await page.goto("/dashboard/companies");
  await expect(
    page.locator("main li").getByText("Empresa PhaseThreeA", { exact: true }),
  ).toBeVisible();
  await page
    .locator("main")
    .getByLabel("Organización activa")
    .selectOption(a.org.id);
  await expect(page).toHaveURL(/\/dashboard$/);
  pass(
    "companies lists memberships, creates another OWNER organization and safely switches workspace",
  );
  await writeFile(
    "test-results/phase3-e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        browserErrors: errors.length,
        database: "ephemeral local PGlite; no Neon",
      },
      null,
      2,
    ),
  );
  await anon.close();
  await a.context.close();
  await b.context.close();
} catch (error) {
  await writeFile("test-results/phase3-server.log", logs);
  await writeFile(
    "test-results/phase3-e2e-summary.json",
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  app.kill();
  if (app.exitCode === null)
    await new Promise((resolve) => app.once("exit", resolve));
  await database.close();
}
