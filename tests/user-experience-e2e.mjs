import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startDatabase } from "../scripts/local-database.mjs";
import { mkdir, writeFile } from "node:fs/promises";

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
const a11yFailures = [];
const pass = (name) => {
  checks.push(name);
  console.log("PASS " + name);
};
const widths = [360, 390, 430, 768, 820, 1024, 1280, 1440];
const password = randomBytes(20).toString("base64url") + "-9aZ";
await mkdir("test-results/experience", { recursive: true });
try {
  for (let i = 0; i < 120 && !logs.includes("Ready in"); i++) {
    if (app.exitCode !== null) throw new Error("Local app exited");
    await new Promise((r) => setTimeout(r, 500));
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
  const page = await context.newPage(),
    errors = [],
    analytics = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\/(?:_vercel\/insights|va\/|analytics)/.test(r.url()))
      analytics.push(r.url());
  });
  const post = async (path, data, status = 200, client = context.request) => {
    const response = await client.post(path, {
      headers: { Origin: baseURL },
      data,
    });
    assert.equal(response.status(), status, await response.text());
    return response.json();
  };
  const preferences = async () => {
    const response = await context.request.get("/api/user/preferences");
    assert.equal(response.status(), 200);
    return response.json();
  };
  await page.goto("/register");
  await page
    .getByRole("button", { name: "Rechazar analíticas", exact: true })
    .click();
  // All five steps at every required width, real fieldsets/radios in both themes.
  for (const theme of ["DARK", "LIGHT"]) {
    await page.goto("/register");
    await page.locator('input[name="theme"][value="' + theme + '"]').check();
    for (let step = 0; step < 5; step++) {
      if (step === 3) await page.locator('input[value="OTHER"]').check();
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "wizard overflow " + width + " " + step + " " + theme,
        );
        const a11y = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        if (a11y.violations.length)
          a11yFailures.push({
            page: "wizard",
            width,
            step,
            theme,
            violations: a11y.violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => ({
                target: n.target,
                summary: n.failureSummary,
              })),
            })),
          });
        if (step === 0 && [390, 1440].includes(width)) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: `test-results/experience/wizard-${theme}-${width}.png`,
            fullPage: true,
          });
        }
      }
      if (step < 4)
        await page
          .getByRole("button", { name: "Continuar", exact: true })
          .click();
    }
  }
  pass("wizard: 5 steps × 8 widths × LIGHT/DARK, no overflow");
  await page.getByLabel("Nombre", { exact: true }).fill("Experience");
  await page.getByLabel("Apellidos", { exact: true }).fill("Owner");
  await page
    .getByLabel("Correo", { exact: true })
    .fill("experience-owner@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Regresar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByLabel("Correo", { exact: true })).toHaveValue(
    "experience-owner@example.test",
  );
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveValue("");
  // Change language and verify the remaining wizard immediately.
  await page.getByRole("button", { name: "Regresar", exact: true }).click();
  await page.getByRole("button", { name: "Regresar", exact: true }).click();
  await page.getByRole("button", { name: "Regresar", exact: true }).click();
  await page.getByRole("radio", { name: "English", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  for (const checkbox of await page.getByRole("checkbox").all()) {
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeDisabled();
  }
  await expect(
    page.getByRole("heading", {
      name: "Essential service communications",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(password + "x");
  let signupCalls = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/auth/sign-up/email"))
      signupCalls++;
  });
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  assert.equal(signupCalls, 0);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.locator("form").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30000 });
  assert.equal(signupCalls, 1);
  const pref = await preferences();
  assert.equal(pref.theme, "LIGHT");
  assert.equal(pref.locale, "en-US");
  assert.equal(pref.jobRole, "OTHER");
  assert.equal(pref.onboardingCompleted, true);
  assert.equal(
    (
      await database.db.query(
        'SELECT COUNT(*)::int AS n FROM "CommunicationConsentRecord"',
      )
    ).rows[0].n,
    0,
  );
  const user = (
    await database.db.query(
      'SELECT id,name,"givenName","familyName","emailVerified" FROM "User" WHERE email=$1',
      ["experience-owner@example.test"],
    )
  ).rows[0];
  assert.equal(user.givenName, "Experience");
  assert.equal(user.familyName, "Owner");
  assert.equal(user.name, "Experience Owner");
  assert.equal(user.emailVerified, false);
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  for (const privateValue of [
    password,
    "experience-owner@example.test",
    "Experience Owner",
  ])
    assert(!storage.includes(privateValue));
  assert.equal(analytics.length, 0);
  pass(
    "real Better Auth registration once, immediate EN, saved preferences, no password storage or fabricated consent/verification",
  );
  await page
    .getByLabel("Company or organization name")
    .fill("Experience local QA");
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/fiscal-profile$/, {
    timeout: 30000,
  });
  await page.goto("/dashboard/user");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "LIGHT");
  const ssr = await context.request.get("/dashboard/user");
  const html = await ssr.text();
  assert(
    /data-theme="LIGHT"/.test(html) && /lang="en-US"/.test(html),
    "SSR restores preferences before hydration",
  );
  const settings = page.locator(".experience-settings");
  await page.getByLabel("Accent color").selectOption("BLUE");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(
    page.getByText("Preferences saved.", { exact: true }),
  ).toBeVisible();
  const afterAccent = await preferences();
  assert.equal(afterAccent.accent, "BLUE");
  assert.equal(afterAccent.theme, "LIGHT");
  assert.equal(afterAccent.locale, "en-US");
  await settings
    .getByRole("radio", { name: "Finance / Accounting", exact: true })
    .click();
  await expect(
    settings.getByRole("radio", { name: "Finance / Accounting", exact: true }),
  ).toBeChecked();
  assert.equal((await preferences()).jobRole, "FINANCE_ACCOUNTING");
  pass(
    "account/accent compatibility and professional-role changes persist through real Settings APIs",
  );
  await settings.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "DARK");
  await settings.getByRole("radio", { name: "Español", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");
  await page.reload();
  await expect(
    settings.getByRole("radio", { name: "Oscuro", exact: true }),
  ).toBeChecked();
  const second = await browser.newContext({ baseURL });
  await post(
    "/api/auth/sign-in/email",
    { email: "experience-owner@example.test", password },
    200,
    second.request,
  );
  const current = await preferences();
  await post(
    "/api/user/preferences",
    { theme: "LIGHT", revision: current.revision },
    200,
    second.request,
  );
  await settings.getByRole("radio", { name: "Claro", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("otra sesión");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "LIGHT");
  // Failure is injected, never a success. Client retains confirmed state.
  await page.route("**/api/user/preferences", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } })
      : route.continue(),
  );
  await settings.getByRole("radio", { name: "Oscuro", exact: true }).click();
  await expect(settings.getByRole("alert")).toBeVisible();
  await expect(
    settings.getByRole("radio", { name: "Claro", exact: true }),
  ).toBeChecked();
  await page.unroute("**/api/user/preferences");
  pass(
    "settings persist across reload/devices, 409 reconciles current server state, failed writes roll back",
  );
  const revision = (await preferences()).revision;
  for (const invalid of [
    { locale: "fr-FR" },
    { theme: "SYSTEM" },
    { jobRole: "Owner" },
    { userId: user.id },
    { communications: { ESSENTIAL: false } },
    { country: "MX" },
    { currency: "USD" },
  ])
    await post("/api/user/preferences", { ...invalid, revision }, 400);
  const blocked = await post(
    "/api/user/preferences",
    { communications: { COMMERCIAL_OFFERS: true }, revision },
    409,
  );
  assert.equal(blocked.code, "COMMUNICATIONS_UNAVAILABLE");
  const other = await browser.newContext({ baseURL });
  await post(
    "/api/auth/sign-up/email",
    {
      name: "Other local QA",
      email: "experience-other@example.test",
      password,
    },
    200,
    other.request,
  );
  const otherResponse = await other.request.get("/api/user/preferences");
  const otherPref = await otherResponse.json();
  assert.equal(otherPref.theme, "DARK");
  assert.equal(otherPref.locale, "es-MX");
  await post(
    "/api/user/preferences",
    { userId: user.id, theme: "LIGHT", revision: 0 },
    400,
    other.request,
  );
  await post(
    "/api/auth/sign-up/email",
    {
      name: "Duplicate local QA",
      email: "experience-owner@example.test",
      password,
    },
    422,
    other.request,
  );
  assert.equal(
    (await database.db.query('SELECT COUNT(*)::int AS n FROM "User"')).rows[0]
      .n,
    2,
  );
  pass(
    "strict API allowlists, user isolation, duplicate account rejection and commercial legal gate",
  );
  for (const theme of ["LIGHT", "DARK"]) {
    const state = await preferences();
    await post("/api/user/preferences", { theme, revision: state.revision });
    await page.reload();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "settings overflow " + width,
      );
      const a11y = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      if (a11y.violations.length)
        a11yFailures.push({
          page: "settings",
          width,
          theme,
          violations: a11y.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        });
      if ([390, 820, 1440].includes(width)) {
        await page.screenshot({
          path:
            "test-results/experience/settings-" + theme + "-" + width + ".png",
          fullPage: true,
        });
      }
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
    "auto",
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/dashboard/fiscal-profile");
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Menú de navegación" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  pass(
    "settings/navigation: all 8 widths, both themes, Axe AA and reduced motion",
  );
  await writeFile(
    "test-results/experience/accessibility.json",
    JSON.stringify(a11yFailures, null, 2),
  );
  assert.deepEqual(
    a11yFailures,
    [],
    "Axe AA across both themes and all required widths",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/experience/summary.json",
    JSON.stringify({ passed: true, checks, widths }, null, 2),
  );
  await second.close();
  await other.close();
  await context.close();
} catch (error) {
  await writeFile(
    "test-results/experience/summary.json",
    JSON.stringify(
      { passed: false, checks, error: String(error), a11yFailures },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  if (app.exitCode === null) {
    if (process.platform === "win32")
      execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else app.kill("SIGTERM");
  }
  await database.close();
}
