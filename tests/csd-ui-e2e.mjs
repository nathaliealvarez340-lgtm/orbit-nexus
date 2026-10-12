import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import { startDatabase } from "../scripts/local-database.mjs";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Local-only UI integration. Real API flows use Claude's synthetic certificate harness.
// Browser route fixtures below exercise unavailable/error states only, never ISSUED.
const database = await startDatabase();
const baseURL = "http://localhost:3101",
  authority = syntheticAuthority();
const guarded = ["AGENTS.md", "CLAUDE.md"],
  before = await Promise.all(guarded.map((file) => readFile(file)));
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^VERCEL/i.test(key) &&
      !/^(AI_AGENT|CLAUDECODE|CLAUDE_CODE.*|CURSOR_.*|CODEX_.*|GEMINI_CLI|ANTIGRAVITY_AGENT|AUGMENT_AGENT|OPENCODE_CLIENT|REPL_ID|COPILOT_.*)$/i.test(
        key,
      ),
  ),
);
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3101",
  ],
  {
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...inherited,
      NODE_ENV: "development",
      DATABASE_URL: database.url,
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      MAIL_API_URL: "",
      MAIL_API_TOKEN: "",
      OCR_API_URL: "",
      OCR_API_TOKEN: "",
      PRIVACY_NOTICE_VERSION: "",
      PAC_ENVIRONMENT: "SANDBOX",
      CSD_KEY_PROVIDER_SANDBOX: "env",
      CSD_KEY_PROVIDER_PRODUCTION: "",
      CSD_KEK_ID: "synthetic-ui-test",
      CSD_KEK_CURRENT_VERSION: "1",
      CSD_KEK_V1: randomBytes(32).toString("base64"),
      CSD_REAUTH_WINDOW_SECONDS: "",
      CSD_E2E_HARNESS: "local-ephemeral-only",
      CSD_E2E_TEST_AUTHORITIES: Buffer.from(authority.certificate).toString(
        "base64",
      ),
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
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(response, status = 200) {
  assert.equal(response.status(), status, "Unexpected response status");
  return response.json();
}
const post = (context, path, data) =>
  context.request.post(path, { headers: origin, data });
const rfc = "SCA010101AB1";
const first = syntheticCsd(authority, { rfc }),
  second = syntheticCsd(authority, { rfc });
async function files(page, material = first) {
  await page.getByLabel("Certificado .cer", { exact: true }).setInputFiles({
    name: "synthetic.cer",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(material.certificate),
  });
  await page.getByLabel("Llave privada .key", { exact: true }).setInputFiles({
    name: "synthetic.key",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(material.privateKey),
  });
}
const password = (page) => page.locator('input[name="password"]');
const acceptance = (page) =>
  page.getByRole("checkbox", { name: /He leído y acepto los términos/ });
const configure = (page) =>
  page.getByRole("button", { name: "Validar y configurar CSD", exact: true });
async function ready(page) {
  await expect(
    page.getByRole("button", { name: "Volver a cargar estado" }),
  ).toBeEnabled({ timeout: 120000 });
}
await mkdir("test-results", { recursive: true });
try {
  const deadline = Date.now() + 180000;
  while (true) {
    try {
      if (
        (
          await fetch(baseURL + "/login", {
            signal: AbortSignal.timeout(120000),
          })
        ).ok
      )
        break;
    } catch {}
    if (app.exitCode !== null || Date.now() > deadline)
      throw new Error("Local UI server not ready");
    await pause(500);
  }
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === "win32" ? "msedge" : undefined,
  });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const loginPassword = randomBytes(24).toString("base64url") + "-9aZ";
  const owner = (
    await json(
      await post(context, "/api/auth/sign-up/email", {
        name: "CSD UI Owner",
        email: "csd-ui-owner@example.test",
        password: loginPassword,
      }),
    )
  ).user;
  const org = await json(
    await post(context, "/api/organizations", {
      name: "CSD UI local synthetic",
    }),
    201,
  );
  await database.db.query(
    `INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,"confirmedAt","updatedAt") VALUES ($1,$2,$3,$4,'SYNTHETIC UI','601','42501','G03','synthetic@example.test',NOW(),NOW())`,
    ["fp-ui", owner.id, org.id, rfc],
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  const browserLogs = [];
  page.on("console", (message) => browserLogs.push(message.text()));
  const analytics = [];
  page.on("request", (request) => {
    if (/(_vercel\/insights|vitals|analytics)/.test(request.url()))
      analytics.push(request.url());
  });
  await page.goto("/dashboard/stamping");
  await page.getByRole("button", { name: "Rechazar analíticas" }).click();
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "Sin CSD configurado", exact: true }),
  ).toBeVisible();
  const terms = await json(await context.request.get("/api/csd/custody-terms"));
  const text = await page.locator(".csd-terms p").allTextContents();
  assert.equal(text.join("\n\n"), terms.text);
  await expect(configure(page)).toBeDisabled();
  await files(page);
  await password(page).fill(first.password);
  await expect(configure(page)).toBeDisabled();
  await acceptance(page).check();
  pass(
    "OWNER real context, exact canonical preliminary terms and mandatory explicit acceptance",
  );

  for (const width of [360, 390, 430, 768, 820, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Overflow at ${width}`,
    );
    const results = await new AxeBuilder({ page })
      .include(".csd-ui")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      results.violations.map((v) => v.id),
      [],
      `CSD accessibility at ${width}`,
    );
  }
  pass(
    "all eight widths: capture/terms without overflow and axe WCAG AA clean",
  );
  await password(page).fill("wrong-synthetic-password");
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/api/csd", async (route) => {
    if (route.request().method() === "POST") {
      await held;
      await route.continue();
    } else await route.continue();
  });
  await configure(page).click();
  await expect(password(page)).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Validando y protegiendo CSD…" }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByText(
      "No pudimos abrir la llave privada con la contraseña proporcionada.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 120000 });
  await expect(password(page)).toHaveValue("");
  assert.equal(
    await page
      .locator('input[name="privateKey"]')
      .evaluate((input) => input.files.length),
    1,
  );
  await expect(acceptance(page)).not.toBeChecked();
  await page.unroute("**/api/csd");
  pass(
    "real invalid-password API, immediate field erasure before response, files retained only for validation retry",
  );

  await password(page).fill(first.password);
  await acceptance(page).check();
  await configure(page).click();
  await expect(
    page.getByText(
      "CSD configurado correctamente. No se emitió ninguna factura.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 120000 });
  await ready(page);
  const active = await json(await context.request.get("/api/csd"));
  assert.equal(active.status, "VALID");
  assert.equal(await password(page).count(), 0);
  await expect(page.locator(".csd-history tbody tr")).toHaveCount(1);
  for (const width of [360, 390, 430, 768, 820, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("table", { name: "Historial del CSD", exact: true }),
    ).toBeVisible();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `History overflow at ${width}`,
    );
    const a11y = await new AxeBuilder({ page })
      .include(".csd-ui")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      a11y.violations.map((v) => v.id),
      [],
      `History accessibility at ${width}`,
    );
  }
  pass(
    "real multipart configuration and secure history, no password/file form after success",
  );

  await page
    .getByRole("button", { name: "Sustituir CSD", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancelar", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sustituir CSD", exact: true }),
  ).toBeFocused();
  for (const width of [360, 390, 430, 768, 820, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .getByRole("button", { name: "Sustituir CSD", exact: true })
      .click();
    const box = await page.getByRole("dialog").boundingBox();
    assert(box.width <= width && box.x >= 0 && box.height <= 900);
    const a11y = await new AxeBuilder({ page })
      .include(".csd-dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      a11y.violations.map((v) => v.id),
      [],
    );
    await page.keyboard.press("Escape");
  }
  await page
    .getByRole("button", { name: "Sustituir CSD", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continuar con la sustitución", exact: true })
    .click();
  await files(page, second);
  await password(page).fill(second.password);
  await acceptance(page).check();
  const replacementRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/csd") && request.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Validar y sustituir CSD", exact: true })
    .click();
  await replacementRequest;
  await expect(
    page.getByText(
      "CSD configurado correctamente. No se emitió ninguna factura.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 120000 });
  await ready(page);
  assert.notEqual(
    (await json(await context.request.get("/api/csd"))).id,
    active.id,
  );
  await expect(page.locator(".csd-history tbody tr")).toHaveCount(2);
  await expect(
    page.locator(".csd-history").getByText("Sustituido", { exact: true }),
  ).toBeVisible();
  pass(
    "real replacement, expected active id, accessible confirmation/focus/Escape and old history preserved",
  );

  const memberContext = await browser.newContext({ baseURL });
  const member = (
    await json(
      await post(memberContext, "/api/auth/sign-up/email", {
        name: "CSD UI Member",
        email: "csd-ui-member@example.test",
        password: loginPassword,
      }),
    )
  ).user;
  await database.db.query(
    `INSERT INTO "Membership" (id,"organizationId","userId",role) VALUES ('member-ui',$1,$2,'MEMBER')`,
    [org.id, member.id],
  );
  await json(
    await post(memberContext, "/api/organizations/active", {
      organizationId: org.id,
    }),
  );
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/dashboard/stamping");
  await expect(
    memberPage
      .getByText("Solo un administrador puede ver y gestionar el CSD.", {
        exact: true,
      })
      .last(),
  ).toBeVisible({ timeout: 120000 });
  assert.equal((await memberContext.request.get("/api/csd")).status(), 403);
  assert.equal(
    await memberPage.locator(".csd-status, .csd-form, .csd-history").count(),
    0,
  );
  await database.db.query(
    `UPDATE "Membership" SET role='ADMIN' WHERE id='member-ui'`,
  );
  await memberPage.reload();
  await ready(memberPage);
  await expect(
    memberPage.getByRole("button", { name: "Deshabilitar CSD", exact: true }),
  ).toBeEnabled();
  await memberPage
    .getByRole("button", { name: "Deshabilitar CSD", exact: true })
    .click();
  await memberPage
    .getByRole("button", { name: "Confirmar deshabilitación", exact: true })
    .click();
  await expect(
    memberPage.getByText(
      "CSD deshabilitado. Su llave privada cifrada fue eliminada.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 120000 });
  await ready(memberPage);
  await expect(
    memberPage
      .locator(".csd-history")
      .getByText("Deshabilitado", { exact: true }),
  ).toBeVisible();
  assert.equal(
    (await json(await memberContext.request.get("/api/csd"))).status,
    "NOT_CONFIGURED",
  );
  pass(
    "real MEMBER 403 exposes no metadata; real ADMIN can disable with confirmation and history",
  );
  await memberContext.close();

  await database.db.query(
    `UPDATE "Session" SET "createdAt"=(NOW() AT TIME ZONE 'UTC') - INTERVAL '20 minutes' WHERE "userId"=$1`,
    [owner.id],
  );
  await page.reload();
  await ready(page);
  await files(page);
  await password(page).fill(first.password);
  await acceptance(page).check();
  await configure(page).click();
  await expect(
    page.getByText(
      "Por seguridad, vuelve a iniciar sesión antes de modificar tu CSD.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(await password(page).count(), 0);
  await page
    .getByRole("link", { name: "Volver a iniciar sesión y regresar a CSD" })
    .click();
  await page
    .getByLabel("Correo", { exact: true })
    .fill("csd-ui-owner@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill(loginPassword);
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(baseURL + "/dashboard/stamping", {
    timeout: 120000,
  });
  await ready(page);
  await expect(password(page)).toHaveValue("");
  pass(
    "real stale-session 401, cleared capture and Better Auth login returns to protected CSD route",
  );

  // Explicit test-only API fixtures: no success/issuance is fabricated in application code.
  const empty = await json(await context.request.get("/api/csd"));
  let fixtureState = empty,
    errorCode = null;
  const bundled = await build({
    entryPoints: ["src/components/csd/transport.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  const { csdMessages } = await import(
    "data:text/javascript;base64," +
      Buffer.from(bundled.outputFiles[0].text).toString("base64")
  );
  await page.route("**/api/csd", async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({ json: fixtureState });
    else
      await route.fulfill({
        status:
          errorCode === "CSD_REAUTH_REQUIRED"
            ? 401
            : errorCode === "CSD_CONFLICT"
              ? 409
              : 400,
        json: {
          code: errorCode,
          error: "OpenSSL ASN.1 secret-marker-test-only",
        },
      });
  });
  fixtureState = { ...empty, serviceAvailable: false };
  await page.reload();
  await ready(page);
  assert.equal(await page.locator(".csd-form").count(), 0);
  await expect(
    page.getByText("La custodia de CSD no está disponible en este entorno.", {
      exact: true,
    }),
  ).toBeVisible();
  fixtureState = {
    ...active,
    status: "EXPIRED",
    verification: { ...active.verification, withinValidity: false },
  };
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("heading", {
      name: "El certificado está vencido",
      exact: true,
    }),
  ).toBeVisible();
  for (const reason of [
    "NOT_YET_VALID",
    "RFC_CHANGED",
    "KEY_UNAVAILABLE",
    "INTEGRITY",
  ]) {
    fixtureState = { ...active, status: "INVALID", invalidReason: reason };
    await page.reload();
    await ready(page);
    await expect(
      page.getByRole("heading", {
        name: "El CSD requiere atención",
        exact: true,
      }),
    ).toBeVisible();
  }
  pass(
    "isolated fixtures: service unavailable, expired and all four invalid causes",
  );
  fixtureState = empty;
  for (const code of Object.keys(csdMessages)) {
    errorCode = code;
    await page.reload();
    await ready(page);
    await files(page);
    await password(page).fill(first.password);
    await acceptance(page).check();
    await configure(page).click();
    await expect(
      page
        .locator(".csd-ui")
        .getByText(csdMessages[code], { exact: true })
        .first(),
    ).toBeVisible();
    const input = password(page);
    if (await input.count()) await expect(input).toHaveValue("");
    assert(
      !(await page.locator("body").innerText()).includes(
        "secret-marker-test-only",
      ),
    );
    if (code === "CSD_CONFLICT") {
      await ready(page);
      assert.equal(await configure(page).count(), 0);
      await expect(
        page.getByText(/Los nuevos envíos están bloqueados/),
      ).toBeVisible();
    }
  }
  await page.unroute("**/api/csd");
  pass(
    "isolated error responses: all 23 curated codes, password erasure and conflict requires explicit reload",
  );

  await page.reload();
  await ready(page);
  await files(page);
  await password(page).fill(first.password);
  await page
    .getByRole("button", { name: "Cancelar y limpiar", exact: true })
    .click();
  await ready(page);
  assert.equal(await password(page).count(), 0);
  await page.getByRole("button", { name: "Volver a cargar estado" }).click();
  await ready(page);
  assert.equal(
    await page
      .locator('input[name="privateKey"]')
      .evaluate((input) => input.files.length),
    0,
  );
  await files(page);
  await password(page).fill(first.password);
  await page.goto("/dashboard/fiscal-profile");
  await expect(
    page.getByRole("link", { name: "Administrar CSD", exact: true }),
  ).toBeVisible();
  assert.equal(await page.locator(".csd-form").count(), 0);
  await page.goto("/dashboard/stamping");
  await ready(page);
  await expect(password(page)).toHaveValue("");
  assert.equal(
    await page
      .locator('input[name="privateKey"]')
      .evaluate((input) => input.files.length),
    0,
  );
  assert.equal(
    await page.evaluate(() =>
      Object.values({ ...localStorage, ...sessionStorage }).some((value) =>
        /synthetic\.key|wrong-synthetic-password/.test(value),
      ),
    ),
    false,
  );
  assert(
    !logs.includes(first.password) &&
      !browserLogs.join("\n").includes(first.password),
  );
  assert.deepEqual(analytics, []);
  assert.deepEqual(errors, []);
  for (let i = 0; i < guarded.length; i++)
    assert.deepEqual(await readFile(guarded[i]), before[i]);
  pass(
    "cancel/navigation clear files and password; profile read-only summary; no secrets in logs/storage/analytics",
  );
  await writeFile(
    "test-results/csd-ui-e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        widths: [360, 390, 430, 768, 820, 1024, 1280, 1440],
        boundary:
          "ephemeral local only; synthetic CA is not SAT evidence; explicit isolated error fixtures; no PAC or ISSUED",
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    "test-results/csd-ui-e2e-summary.json",
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  if (app.exitCode === null && app.signalCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve));
    if (process.platform === "win32")
      execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else process.kill(-app.pid, "SIGTERM");
    await exited;
  }
  await database.close();
}
