import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, request, expect } from "@playwright/test";
import { startDatabase } from "./local-database.mjs";

const port = Number(process.env.ORBIT_TEST_PORT || 3197),
  baseURL = "http://localhost:" + port;
const database = await startDatabase();
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/e2e-summary.json",
  JSON.stringify({ passed: false, state: "running" }),
);
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
app.stdout.on("data", (b) => {
  logs += b;
});
app.stderr.on("data", (b) => {
  logs += b;
});
let browser;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDioAAAAASUVORK5CYII=",
  "base64",
);
const file = { name: "receipt.png", mimeType: "image/png", buffer: png };
const origin = { Origin: baseURL };
const currentDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const testYear = Number(currentDate.slice(0, 4));
const assertions = [];
const pass = (label) => {
  assertions.push(label);
  console.log("PASS " + label);
};
async function json(res, expected = 200) {
  assert.equal(res.status(), expected, await res.text());
  return res.json();
}
async function query(sql, params = []) {
  return (await database.db.query(sql, params)).rows;
}
try {
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      const res = await fetch(baseURL + "/login");
      if (res.ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw new Error("App did not start: " + logs.slice(-1500));
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    locale: "es-MX",
  });
  const page = await context.newPage();
  // Test-only camera: browser generates frames; no physical device is claimed.
  await context.addInitScript(() => {
    const original = navigator.mediaDevices?.getUserMedia.bind(
      navigator.mediaDevices,
    );
    window.__cameraStreams = [];
    if (original)
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await original(...args);
        window.__cameraStreams.push(stream);
        return stream;
      };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  pass("anonymous dashboard redirects to login");
  await page.goto("/register");
  await page.getByRole("button", { name: "Rechazar no esenciales" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Usuario de prueba A");
  await page.getByLabel("Correo", { exact: true }).fill("orbit-a@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("OrbitSecure2026!");
  await page
    .getByLabel("Confirmar contraseña", { exact: true })
    .fill("OrbitSecure2026!");
  const signupResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/sign-up/email") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  const signup = await signupResponse;
  assert.equal(
    signup.status(),
    200,
    signup.status() === 200 ? "" : await signup.text(),
  );
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 20000 });
  await page
    .getByLabel("Nombre de empresa u organización")
    .fill("Organización A");
  await page
    .getByRole("button", { name: "Crear organización", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20000 });
  await expect(
    page.getByRole("heading", { name: "Panorama fiscal" }),
  ).toBeVisible();
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name.endsWith("session_token"));
  assert(sessionCookie?.httpOnly);
  assert(sessionCookie.secure);
  assert.equal(sessionCookie.sameSite, "Lax");
  const orgA = (
    await query('SELECT id FROM "Organization" WHERE name=$1', [
      "Organización A",
    ])
  )[0].id;
  pass("UI register → organization OWNER → real dashboard with secure cookies");
  await page
    .getByRole("button", { name: "Capturar ticket", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tomar foto", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Seleccionar ticket", { exact: true })
    .setInputFiles(file);
  await page
    .getByRole("button", { name: "Confirmar archivo y analizar" })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/tickets\/[^/]+$/, {
    timeout: 20000,
  });
  const ticketId = page.url().split("/").pop();
  await expect(
    page.getByText("El OCR aún no está conectado.", { exact: false }),
  ).toBeVisible();
  assert.equal(
    (await query('SELECT COUNT(*)::int AS count FROM "Expense"'))[0].count,
    0,
  );
  await page.getByLabel("Comercio", { exact: true }).fill("OXXO");
  await page.getByLabel("Fecha", { exact: true }).fill(currentDate);
  await page.getByLabel("Total (MXN)", { exact: true }).fill("120.50");
  await page.getByLabel("Folio", { exact: true }).fill("F123");
  await page.getByText("Información adicional", { exact: true }).click();
  await page.getByLabel("Número de operación / ID / TR").fill("ID456");
  await page
    .getByRole("button", { name: "Confirmar y registrar", exact: true })
    .click();
  await expect(
    page.getByText("Confirmado y registrado", { exact: true }),
  ).toBeVisible();
  const afterConfirm = await query(
    'SELECT total::text FROM "Expense" WHERE "ticketId"=$1',
    [ticketId],
  );
  assert.equal(afterConfirm[0].total, "120.50");
  await json(
    await context.request.post("/api/tickets/" + ticketId + "/confirm", {
      headers: origin,
      data: { merchant: "Changed", purchaseDate: "2026-01-01", total: "999" },
    }),
  );
  assert.equal(
    (
      await query(
        'SELECT COUNT(*)::int AS count FROM "Expense" WHERE "ticketId"=$1',
        [ticketId],
      )
    )[0].count,
    1,
  );
  assert.equal(
    (
      await query('SELECT total::text FROM "Expense" WHERE "ticketId"=$1', [
        ticketId,
      ])
    )[0].total,
    "120.50",
  );
  pass(
    "capture → honest OCR fallback → editable review → confirmation exactly once",
  );
  await page.getByRole("link", { name: "Ver dashboard actualizado →" }).click();
  await expect(
    page.getByText("$120.50", { exact: true }).first(),
  ).toBeVisible();
  pass("navigation back to dashboard immediately reflects confirmed expense");
  const ticket = await json(
    await context.request.get("/api/tickets/" + ticketId),
  );
  const apiB = await request.newContext({ baseURL, extraHTTPHeaders: origin });
  await json(
    await apiB.post("/api/auth/sign-up/email", {
      data: {
        name: "Usuario B",
        email: "orbit-b@example.test",
        password: "OrbitSecure2026!",
      },
    }),
  );
  const orgB = await json(
    await apiB.post("/api/organizations", { data: { name: "Organización B" } }),
    201,
  );
  assert.equal((await json(await apiB.get("/api/tickets"))).count, 0);
  for (const path of [
    "/api/tickets/" + ticketId,
    "/api/documents/" + ticket.documentId,
  ])
    await json(await apiB.get(path), 404);
  await json(
    await apiB.post("/api/tickets/" + ticketId + "/confirm", {
      data: { merchant: "Other", purchaseDate: currentDate, total: "120.50" },
    }),
    404,
  );
  await json(await apiB.post("/api/tickets/" + ticketId + "/analyze"), 404);
  await json(await apiB.post("/api/tickets/" + ticketId + "/invoice"), 404);
  await json(
    await apiB.patch("/api/tickets/" + ticketId + "/invoice", {
      data: { folio: "FOREIGN" },
    }),
    404,
  );
  await json(
    await apiB.post("/api/organizations/active", {
      data: { organizationId: orgA },
    }),
    404,
  );
  await json(
    await context.request.post("/api/organizations/active", {
      headers: origin,
      data: { organizationId: orgB.id },
    }),
    404,
  );
  await json(
    await context.request.post("/api/organizations", {
      headers: { Origin: "https://attacker.test" },
      data: { name: "CSRF" },
    }),
    403,
  );
  pass(
    "cross-tenant ticket, document, confirmation, OCR, invoice and workspace access rejected; CSRF rejected",
  );
  await json(
    await context.request.post("/api/tickets", {
      headers: origin,
      multipart: {
        file: {
          name: "bad.png",
          mimeType: "image/png",
          buffer: Buffer.from("<html>not an image</html>"),
        },
      },
    }),
    400,
  );
  await json(
    await context.request.post("/api/tickets", {
      headers: origin,
      multipart: {
        file: {
          name: "large.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
        },
      },
    }),
    413,
  );
  pass("server rejects spoofed MIME/signatures and oversized uploads");
  for (const invalid of [
    { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
    { name: "wrong.jpg", mimeType: "image/png", buffer: png },
    {
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    },
    { name: "receipt.exe", mimeType: "application/octet-stream", buffer: png },
  ])
    await json(
      await context.request.post("/api/tickets", {
        headers: origin,
        multipart: { file: invalid },
      }),
      400,
    );
  const images = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "black";
    ctx.fillText("Ticket", 5, 20);
    return {
      jpeg: canvas.toDataURL("image/jpeg").split(",")[1],
      webp: canvas.toDataURL("image/webp").split(",")[1],
    };
  });
  const validFiles = [
    file,
    {
      name: "ticket.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(images.jpeg, "base64"),
    },
    {
      name: "ticket.jpeg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(images.jpeg, "base64"),
    },
    {
      name: "ticket.webp",
      mimeType: "image/webp",
      buffer: Buffer.from(images.webp, "base64"),
    },
    {
      name: "ticket.pdf",
      mimeType: "application/pdf",
      buffer: await page.pdf(),
    },
  ];
  for (const valid of validFiles) {
    const uploaded = await json(
      await context.request.post("/api/tickets", {
        headers: origin,
        multipart: { file: valid, organizationId: orgB.id },
      }),
      201,
    );
    assert.equal(
      (
        await query('SELECT "organizationId" FROM "Ticket" WHERE id=$1', [
          uploaded.id,
        ])
      )[0].organizationId,
      orgA,
    );
  }
  assert.equal(
    (await query('SELECT COUNT(*)::int AS count FROM "Expense"'))[0].count,
    1,
  );
  pass(
    "real JPG/JPEG/PNG/WEBP/PDF accepted; empty, SVG, executable and mismatched extensions rejected; client tenant ignored",
  );
  const pending = await json(
    await context.request.post("/api/tickets/" + ticketId + "/invoice", {
      headers: origin,
    }),
  );
  assert.equal(pending.status, "REQUIRES_DATA");
  const fiscal = {
    rfc: "XAXX010101000",
    legalName: "Usuario de prueba",
    fiscalRegime: "616",
    postalCode: "06600",
    cfdiUse: "G03",
    email: "fiscal@example.test",
    personType: "INDIVIDUAL",
    confirmed: true,
  };
  await json(
    await context.request.post("/api/fiscal-profile", {
      headers: origin,
      data: { ...fiscal, confirmed: false },
    }),
    400,
  );
  await json(
    await context.request.post("/api/fiscal-profile", {
      headers: origin,
      data: fiscal,
    }),
  );
  const prepared = await json(
    await context.request.post("/api/tickets/" + ticketId + "/invoice", {
      headers: origin,
    }),
  );
  assert.equal(prepared.status, "REDIRECT_REQUIRED");
  await json(
    await context.request.patch("/api/tickets/" + ticketId + "/invoice", {
      headers: origin,
      data: { operationNumber: "", total: "1", organizationId: orgB.id },
    }),
  );
  const missingReference = await json(
    await context.request.post("/api/tickets/" + ticketId + "/invoice", {
      headers: origin,
    }),
  );
  assert.equal(missingReference.status, "REQUIRES_DATA");
  assert(missingReference.missing.includes("ID de venta"));
  await page.goto("/dashboard/tickets/" + ticketId);
  await page
    .getByRole("button", { name: "Facturar ticket", exact: true })
    .click();
  await page
    .getByText("Completar referencias del ticket", { exact: true })
    .click();
  await page.getByLabel("Número de operación / ID / TR").fill("ID456");
  await page
    .getByRole("button", { name: "Guardar referencias", exact: true })
    .click();
  await expect(
    page.getByText("Falta completar:", { exact: false }),
  ).not.toBeVisible();
  assert.equal(
    (
      await query('SELECT total::text FROM "Expense" WHERE "ticketId"=$1', [
        ticketId,
      ])
    )[0].total,
    "120.50",
  );
  pass(
    "billing references are editable after confirmation without changing the amount or tenant",
  );
  assert(prepared.portalUrl.startsWith("https://www4.oxxo.com/"));
  assert.equal(
    (await query('SELECT COUNT(*)::int AS count FROM "Invoice"'))[0].count,
    0,
  );
  pass(
    "tenant fiscal profile and assisted portal preparation never fabricate an invoice",
  );
  const userB = (
    await query('SELECT id FROM "User" WHERE email=$1', [
      "orbit-b@example.test",
    ])
  )[0].id;
  await database.db.query(
    'INSERT INTO "Membership" (id,"organizationId","userId",role) VALUES ($1,$2,$3,$4)',
    ["test-member", orgA, userB, "MEMBER"],
  );
  await json(
    await apiB.post("/api/organizations/active", {
      data: { organizationId: orgA },
    }),
  );
  await json(await apiB.post("/api/fiscal-profile", { data: fiscal }), 403);
  await json(
    await apiB.post("/api/fiscal-documents", { multipart: { file } }),
    403,
  );
  await json(
    await apiB.post("/api/organizations/active", {
      data: { organizationId: orgB.id },
    }),
  );
  pass("MEMBER cannot modify tenant fiscal profile");
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const xml = (
    '<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Moneda="MXN" TipoDeComprobante="I" Fecha="2026-09-15T12:00:00" SubTotal="103.88" Total="120.50"><cfdi:Emisor Rfc="AAA010101AAA" Nombre="Comercio de prueba"/><cfdi:Receptor Rfc="XAXX010101000" Nombre="Usuario de prueba" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="616" UsoCFDI="G03"/><cfdi:Impuestos TotalImpuestosTrasladados="16.62"/><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="' +
    uuid +
    '"/></cfdi:Complemento></cfdi:Comprobante>'
  ).replace("2026-09-15", currentDate);
  const importXml = (api, value, confirmed = "true", pdf) =>
    api.post("/api/tickets/" + ticketId + "/invoice-document", {
      headers: origin,
      multipart: {
        xml: {
          name: "cfdi.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(value),
        },
        confirmed,
        ...(pdf ? { pdf } : {}),
      },
    });
  for (const invalidXml of [
    xml.replace("http://www.sat.gob.mx/cfd/4", "https://attacker.test/"),
    xml.replace(
      'xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"',
      'xmlns:tfd="https://attacker.test/" note="http://www.sat.gob.mx/TimbreFiscalDigital"',
    ),
    xml.replace("XAXX010101000", "XEXX010101000"),
    xml.replace('Total="120.50"', 'Total="999.50"'),
    xml.replace(uuid, "invalid-uuid"),
    xml.replace(
      'Fecha="' + currentDate + 'T12:00:00"',
      'Fecha="2026-02-30T12:00:00"',
    ),
    xml.replace(/<cfdi:Complemento>.*<\/cfdi:Complemento>/, ""),
    '<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///private">]>' + xml,
  ])
    await json(await importXml(context.request, invalidXml), 400);
  await json(await importXml(context.request, xml, "false"), 400);
  await json(await importXml(apiB, xml), 404);
  await json(await importXml(context.request, xml, "true", file), 400);
  assert.equal(
    (await query('SELECT COUNT(*)::int AS count FROM "Invoice"'))[0].count,
    0,
  );
  assert.notEqual(
    (
      await query('SELECT "billingStatus" FROM "Ticket" WHERE id=$1', [
        ticketId,
      ])
    )[0].billingStatus,
    "INVOICED",
  );
  pass(
    "invalid namespace, stamp, UUID, RFC, total, date, entities, PDF and missing consent rejected without side effects",
  );
  await json(
    await context.request.post(
      "/api/tickets/" + ticketId + "/invoice-document",
      {
        headers: origin,
        multipart: {
          xml: {
            name: "cfdi.xml",
            mimeType: "application/xml",
            buffer: Buffer.from(xml.replace(uuid, uuid.toUpperCase())),
          },
          confirmed: "true",
          pdf: validFiles[4],
        },
      },
    ),
    201,
  );
  await page.goto("/dashboard/invoices");
  await expect(page.getByText(uuid, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "XML", exact: true }),
  ).toBeVisible();
  assert.equal(
    (
      await query(
        'SELECT COUNT(*)::int AS count FROM "ActivityLog" WHERE action=$1',
        ["INVOICE_COMPLETED"],
      )
    )[0].count,
    1,
  );
  const invoiceDoc = (
    await query('SELECT "xmlDocumentId" FROM "Invoice" WHERE uuid=$1', [uuid])
  )[0].xmlDocumentId;
  await json(await apiB.get("/api/documents/" + invoiceDoc), 404);
  const ownXml = await context.request.get("/api/documents/" + invoiceDoc);
  assert.equal(ownXml.status(), 200);
  assert.match(ownXml.headers()["cache-control"], /no-store/);
  assert.match(ownXml.headers()["content-disposition"], /attachment/);
  await json(await importXml(context.request, xml), 409);
  await json(
    await context.request.patch("/api/tickets/" + ticketId + "/invoice", {
      headers: origin,
      data: { folio: "CHANGED" },
    }),
    409,
  );
  const fiscalDoc = await json(
    await context.request.post("/api/fiscal-documents", {
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
  await page.goto("/dashboard/fiscal-profile?document=" + fiscalDoc.id);
  await expect(page.getByLabel("RFC", { exact: true })).toHaveValue(
    "XAXX010101000",
  );
  assert.equal(
    (
      await query(
        'SELECT "isConfirmed" FROM "UploadedFiscalDocument" WHERE id=$1',
        [fiscalDoc.id],
      )
    )[0].isConfirmed,
    false,
  );
  await json(
    await apiB.post("/api/fiscal-profile", {
      data: { ...fiscal, documentId: fiscalDoc.id },
    }),
    404,
  );
  await page
    .getByLabel("Revisé y confirmo los datos fiscales de esta organización.", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Confirmar y guardar perfil", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Perfil fiscal confirmado y guardado." }),
  ).toBeVisible();
  assert.equal(
    (
      await query(
        'SELECT "isConfirmed" FROM "UploadedFiscalDocument" WHERE id=$1',
        [fiscalDoc.id],
      )
    )[0].isConfirmed,
    true,
  );
  pass(
    "confirmed CFDI import updates real invoice history, metrics and audit trail",
  );
  const oldTicket = await json(
    await context.request.post("/api/tickets", {
      headers: origin,
      multipart: { file },
    }),
    201,
  );
  await json(
    await context.request.post("/api/tickets/" + oldTicket.id + "/analyze", {
      headers: origin,
    }),
  );
  await json(
    await context.request.post("/api/tickets/" + oldTicket.id + "/confirm", {
      headers: origin,
      data: {
        merchant: "Comercio anterior",
        purchaseDate: testYear - 1 + "-01-10",
        total: "75.25",
      },
    }),
  );
  await page.goto("/dashboard?year=" + (testYear - 1));
  await expect(page.getByText("$75.25", { exact: true }).first()).toBeVisible();
  await page.getByText("Ver importes mensuales", { exact: true }).click();
  await expect(
    page.locator("dl").getByText("$75.25", { exact: true }),
  ).toBeVisible();
  await page.goto("/dashboard?year=" + testYear);
  await expect(
    page.getByText("$120.50", { exact: true }).first(),
  ).toBeVisible();
  pass("year filter and monthly bars use confirmed expense dates and amounts");
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["laptop", 1280, 800],
    ["tablet", 820, 1180],
    ["mobile", 390, 844],
    ["mobile-small", 360, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Panorama fiscal" }),
    ).toBeVisible();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      name + " horizontal overflow",
    );
    await page.screenshot({
      path: "test-results/dashboard-" + name + ".png",
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Capturar ticket", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "test-results/capture-mobile.png" });
  await page.getByRole("button", { name: "Tomar foto", exact: true }).click();
  await expect(page.locator("video")).toBeVisible();
  await page.waitForFunction(
    () => document.querySelector("video")?.videoWidth > 0,
  );
  await page
    .getByRole("button", { name: "Capturar imagen", exact: true })
    .click();
  await expect(
    page.getByAltText("Vista previa del documento seleccionado"),
  ).toBeVisible();
  assert(
    await page.evaluate(() =>
      window.__cameraStreams.every((s) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
  );
  await page.getByRole("button", { name: "Repetir foto", exact: true }).click();
  await expect(page.locator("video")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__cameraStreams.every((s) =>
          s.getTracks().every((t) => t.readyState === "ended"),
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page
    .getByRole("button", { name: "Capturar ticket", exact: true })
    .click();
  await page.getByRole("button", { name: "Tomar foto", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "No pudimos abrir la cámara",
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.getByRole("button", { name: "Tomar foto", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "La cámara no está disponible",
  );
  await page.getByLabel("Seleccionar ticket", { exact: true }).setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Selecciona JPG",
  );
  await page.getByLabel("Seleccionar ticket", { exact: true }).setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "10 MB",
  );
  await expect(
    page.getByRole("button", { name: "Confirmar archivo y analizar" }),
  ).not.toBeVisible();
  await page
    .getByLabel("Seleccionar ticket", { exact: true })
    .setInputFiles(file);
  await page
    .getByRole("button", { name: "Confirmar archivo y analizar" })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/tickets\/[^/]+$/);
  await expect(page.getByLabel("Total (MXN)")).toBeVisible();
  pass(
    "mobile floating capture, emulated camera frames/retake/track release, denied/unavailable camera fallback and upload work",
  );
  await page.getByRole("button", { name: "Preferencias de cookies" }).click();
  await page.getByLabel("Analíticas", { exact: false }).check();
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  const consent = (await context.cookies()).find(
    (c) => c.name === "orbit.consent",
  );
  assert.equal(JSON.parse(decodeURIComponent(consent.value)).analytics, true);
  assert.equal(JSON.parse(decodeURIComponent(consent.value)).marketing, false);
  assert(
    (await context.cookies()).some((c) => c.name.endsWith("session_token")),
  );
  pass(
    "desktop/tablet/mobile layouts, accessible capture modal and separate cookie preferences",
  );
  for (const route of [
    "/dashboard/tickets",
    "/dashboard/fiscal-profile",
    "/dashboard/fiscal-documents",
    "/dashboard/companies",
    "/dashboard/stamping",
    "/privacy",
    "/cookies",
    "/terms",
  ]) {
    await page.goto(route);
    assert(!(await page.locator("[data-nextjs-dialog]").count()));
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      route + " horizontal overflow on mobile",
    );
  }
  await page.goto("/onboarding");
  await page
    .getByLabel("Nombre de empresa u organización")
    .fill("Organización C");
  await page
    .getByRole("button", { name: "Crear organización", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByText("Aún no hay gastos confirmados en este año."),
  ).toBeVisible();
  await page.getByLabel("Organización activa").selectOption(orgA);
  await expect(
    page.getByText("$120.50", { exact: true }).first(),
  ).toBeVisible();
  pass(
    "UI workspace creation/switch resets data without leaking previous tenant metrics",
  );
  const contextB = await browser.newContext({
    baseURL,
    storageState: await apiB.storageState(),
  });
  const pageB = await contextB.newPage();
  for (const route of [
    "/dashboard",
    "/dashboard/tickets",
    "/dashboard/invoices",
    "/dashboard/fiscal-documents",
    "/dashboard/fiscal-profile",
  ]) {
    await pageB.goto(route);
    await expect(pageB.getByText("$120.50", { exact: true })).not.toBeVisible();
    await expect(pageB.getByText(uuid, { exact: true })).not.toBeVisible();
  }
  await pageB.goto("/dashboard/tickets/" + ticketId);
  await expect(pageB.getByRole("heading", { name: "404" })).toBeVisible();
  await pageB.goto("/dashboard/fiscal-profile?document=" + fiscalDoc.id);
  await expect(pageB.getByRole("heading", { name: "404" })).toBeVisible();
  await contextB.close();
  pass(
    "tenant B pages cannot render tenant A tickets, invoices, metrics or fiscal documents",
  );
  assert.deepEqual(errors, []);
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await json(await context.request.get("/api/tickets"), 401);
  for (const path of [
    "/api/fiscal-profile",
    "/api/tickets/" + ticketId,
    "/api/documents/" + ticket.documentId,
  ])
    await json(await context.request.get(path), 401);
  for (const path of [
    "/api/tickets",
    "/api/fiscal-documents",
    "/api/fiscal-profile",
    "/api/organizations",
    "/api/organizations/active",
    "/api/tickets/" + ticketId + "/analyze",
    "/api/tickets/" + ticketId + "/confirm",
    "/api/tickets/" + ticketId + "/invoice",
    "/api/tickets/" + ticketId + "/invoice-document",
  ])
    await json(
      await context.request.post(path, { headers: origin, data: {} }),
      401,
    );
  for (const path of [
    "/dashboard",
    "/dashboard/tickets",
    "/dashboard/invoices",
    "/dashboard/fiscal-documents",
    "/dashboard/fiscal-profile",
    "/dashboard/stamping",
    "/dashboard/companies",
    "/dashboard/tickets/new",
    "/dashboard/tickets/" + ticketId,
    "/onboarding",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  pass("logout revokes every private page and API operation");
  await page.goto("/login");
  await page.getByLabel("Correo", { exact: true }).fill("orbit-a@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("OrbitSecure2026!");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  // Logout clears the prior workspace; this user belongs to A and C.
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Organización activa").selectOption(orgA);
  await expect(page).toHaveURL(/\/dashboard$/);
  assert(
    (
      await query(
        "SELECT COUNT(*)::int AS count FROM \"ActivityLog\" WHERE action='LOGIN'",
      )
    )[0].count > 0,
  );
  await json(
    await context.request.post("/api/auth/request-password-reset", {
      headers: origin,
      data: { email: "orbit-a@example.test", redirectTo: "/reset-password" },
    }),
    503,
  );
  let limited = false;
  for (let i = 0; i < 6; i++) {
    const res = await apiB.post("/api/auth/sign-in/email", {
      data: { email: "unknown@example.test", password: "WrongPassword2026!" },
    });
    assert(
      [401, 429].includes(res.status()),
      "unexpected failed-login response: " + res.status(),
    );
    if (res.status() === 429) {
      limited = true;
      break;
    }
  }
  assert(limited, "authentication must throttle repeated failed logins");
  pass(
    "real login creates audit event; unconfigured recovery is explicit; repeated failed logins are rate-limited",
  );
  await apiB.dispose();
  await context.close();
  pass(
    "all screens render without browser errors; logout revokes private access",
  );
  await writeFile(
    "test-results/e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        viewports: ["desktop", "laptop", "tablet", "mobile", "mobile-small"],
        browserErrors: errors.length,
        assertions,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile("test-results/server.log", logs);
  throw error;
} finally {
  await browser?.close();
  app.kill();
  await new Promise((resolve) => {
    if (app.exitCode !== null) resolve();
    else app.once("exit", resolve);
  });
  await database.close();
}
