import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, request, expect } from "@playwright/test";
import { startDatabase } from "./local-database.mjs";
const port = Number(process.env.ORBIT_AUTH_TEST_PORT || 3198),
  baseURL = "http://localhost:" + port;
const database = await startDatabase();
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
      VERCEL: "",
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
let logs = "",
  browser;
app.stdout.on("data", (b) => (logs += b));
app.stderr.on("data", (b) => (logs += b));
const origin = { Origin: baseURL },
  password = "OrbitAuth2026!",
  email = "auth-owner@example.test",
  checks = [];
const pass = (label) => {
  checks.push(label);
  console.log("PASS " + label);
};
const query = async (sql, params = []) =>
  (await database.db.query(sql, params)).rows;
const count = async (table) =>
  (await query('SELECT COUNT(*)::int AS count FROM "' + table + '"'))[0].count;
async function json(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/auth-e2e-summary.json",
  JSON.stringify({ passed: false }),
);
try {
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      if ((await fetch(baseURL + "/login")).ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw new Error("Auth test server failed to start");
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/api/auth/continue");
  await expect(page).toHaveURL(/\/login$/);
  pass("anonymous dashboard and continuation require login");
  await page.goto("/register");
  await page.getByRole("button", { name: "Rechazar no esenciales" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Auth Owner");
  await page.getByLabel("Correo", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page
    .getByLabel("Confirmar contraseña", { exact: true })
    .fill("Mismatch2026!");
  let signupCalls = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/auth/sign-up/email"))
      signupCalls++;
  });
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Las contraseñas no coinciden",
  );
  assert.equal(signupCalls, 0);
  assert.equal(await count("User"), 0);
  pass("mismatched passwords never submit or persist a user");
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill(password);
  // Two synchronous submit events exercise the ref lock before React updates disabled.
  await page.locator("form").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20000 });
  assert.equal(signupCalls, 1);
  assert.equal(await count("User"), 1);
  assert.equal(await count("Account"), 1);
  assert.equal(await count("Session"), 1);
  const user = (
    await query('SELECT id FROM "User" WHERE email=$1', [email])
  )[0];
  const account = (
    await query(
      'SELECT "providerId",password FROM "Account" WHERE "userId"=$1',
      [user.id],
    )
  )[0];
  assert.equal(account.providerId, "credential");
  assert(account.password && account.password !== password);
  assert.equal(await count("Organization"), 0);
  let sessionCookie = (await context.cookies()).find((c) =>
    c.name.endsWith("session_token"),
  );
  assert(sessionCookie?.secure && sessionCookie.httpOnly);
  assert.equal(sessionCookie.sameSite, "Lax");
  await page.reload();
  await expect(page).toHaveURL(/\/onboarding$/);
  pass(
    "real registration persists User/Account/Session once, secure cookies and no-organization onboarding",
  );
  await json(
    await context.request.post("/api/auth/sign-out", {
      headers: origin,
      data: {},
    }),
  );
  await page.goto("/login");
  await page.getByLabel("Correo", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  assert.equal(await count("Organization"), 0);
  assert.equal(await count("Session"), 1);
  sessionCookie = (await context.cookies()).find((c) =>
    c.name.endsWith("session_token"),
  );
  assert(sessionCookie);
  pass("login without memberships requires organization onboarding");
  await page
    .getByLabel("Nombre de empresa u organización")
    .fill("Auth Organization A");
  await page.locator("form").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20000 });
  const membership = (
      await query('SELECT * FROM "Membership" WHERE "userId"=$1', [user.id])
    )[0],
    orgA = membership.organizationId;
  assert.equal(membership.role, "OWNER");
  assert.equal(await count("Organization"), 1);
  assert.equal(await count("Membership"), 1);
  assert.equal(
    (await context.cookies()).find((c) => c.name === "orbit.organization")
      ?.value,
    orgA,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Panorama fiscal" }),
  ).toBeVisible();
  assert.equal(await count("Session"), 1);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
  pass(
    "Organization and OWNER membership persist once; active tenant and session survive refresh",
  );
  const api = await request.newContext({ baseURL, extraHTTPHeaders: origin });
  const duplicate = await api.post("/api/auth/sign-up/email", {
    data: { name: "Duplicate", email, password },
  });
  assert(
    [400, 409, 422].includes(duplicate.status()),
    "duplicate signup must fail: " + duplicate.status(),
  );
  assert.equal(await count("User"), 1);
  assert.equal(await count("Account"), 1);
  assert.equal(await count("Session"), 1);
  pass("duplicate registration cannot create another user/account/session");
  const logoutResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/sign-out") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  assert.equal(await count("Session"), 0);
  const logoutCookies = (await (await logoutResponse).headersArray())
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value.replace(/^([^=]+=)[^;]*/, "$1[hidden]"));
  assert(
    !(await context.cookies()).some(
      (c) =>
        c.name === "orbit.organization" || c.name.includes("better-auth."),
    ),
    JSON.stringify({
      remaining: (await context.cookies()).map((c) => ({
        name: c.name,
        path: c.path,
        secure: c.secure,
      })),
      logoutCookies,
    }),
  );
  await json(await context.request.get("/api/tickets"), 401);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  const replay = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Cookie: sessionCookie.name + "=" + sessionCookie.value,
    },
  });
  await json(await replay.get("/api/tickets"), 401);
  await replay.dispose();
  pass(
    "UI logout deletes DB session and workspace cookie; old session cannot be replayed",
  );
  await page.getByLabel("Correo", { exact: true }).fill(email);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("WrongPassword2026!");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "No se pudo iniciar sesión",
  );
  assert.equal(await count("Session"), 0);
  pass("invalid credentials fail without a session or fake success");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  assert.equal(await count("Session"), 1);
  assert.equal(
    (await context.cookies()).find((c) => c.name === "orbit.organization")
      ?.value,
    orgA,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Panorama fiscal" }),
  ).toBeVisible();
  pass(
    "valid login restores session and selects the only authorized organization",
  );
  const orgA2 = await json(
    await context.request.post("/api/organizations", {
      headers: origin,
      data: { name: "Auth Organization A2" },
    }),
    201,
  );
  await page.goto("/api/auth/continue?returnTo=https://attacker.test");
  await expect(page).toHaveURL(baseURL + "/dashboard");
  await expect(page.getByLabel("Organización activa")).toHaveValue(orgA2.id);
  await context.clearCookies({ name: "orbit.organization" });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/api/auth/continue");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Organización activa").selectOption(orgA);
  await expect(page).toHaveURL(/\/dashboard$/);
  assert.equal(
    (await context.cookies()).find((c) => c.name === "orbit.organization")
      ?.value,
    orgA,
  );
  pass(
    "multiple memberships require explicit workspace choice; valid selection is preserved and no open redirect exists",
  );
  await json(
    await api.post("/api/auth/sign-up/email", {
      data: { name: "Auth User B", email: "auth-b@example.test", password },
    }),
  );
  const orgB = await json(
    await api.post("/api/organizations", {
      data: { name: "Auth Organization B" },
    }),
    201,
  );
  await json(
    await context.request.post("/api/organizations/active", {
      headers: origin,
      data: { organizationId: orgB.id },
    }),
    404,
  );
  await context.addCookies([
    {
      name: "orbit.organization",
      value: orgB.id,
      url: baseURL,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  await json(await context.request.get("/api/tickets"), 409);
  await page.goto("/api/auth/continue");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page
      .getByLabel("Organización activa")
      .locator('option[value="' + orgB.id + '"]'),
  ).toHaveCount(0);
  await page.getByLabel("Organización activa").selectOption(orgA);
  await expect(page).toHaveURL(/\/dashboard$/);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDioAAAAASUVORK5CYII=",
    "base64",
  );
  const foreign = await json(
    await api.post("/api/tickets", {
      multipart: {
        file: { name: "foreign.png", mimeType: "image/png", buffer: png },
      },
    }),
    201,
  );
  const foreignTicket = await json(await api.get("/api/tickets/" + foreign.id));
  await json(await context.request.get("/api/tickets/" + foreign.id), 404);
  await json(
    await context.request.get("/api/documents/" + foreignTicket.documentId),
    404,
  );
  pass(
    "forged tenant cookie/switch and foreign ticket/document IDs cannot cross organizations",
  );
  await json(
    await api.post("/api/auth/sign-in/email", {
      headers: {
        Origin: "https://attacker.test",
        "X-Forwarded-Host": "attacker.test",
        "X-Forwarded-Proto": "https",
      },
      data: { email, password },
    }),
    403,
  );
  await json(
    await context.request.post("/api/organizations/active", {
      headers: {
        Origin: "https://attacker.test",
        "X-Forwarded-Host": "localhost:" + port,
      },
      data: { organizationId: orgA2.id },
    }),
    403,
  );
  pass("untrusted origins are rejected even with forged proxy headers");
  const loggedInCookies = await context.cookies();
  const restarted = await browser.newContext({
    baseURL,
    storageState: await context.storageState(),
  });
  const restartedPage = await restarted.newPage();
  await restartedPage.goto("/dashboard");
  await expect(
    restartedPage.getByRole("heading", { name: "Panorama fiscal" }),
  ).toBeVisible();
  await restarted.close();
  await database.db.query(
    'UPDATE "Session" SET "expiresAt"=NOW()-INTERVAL \'1 hour\' WHERE "userId"=$1',
    [user.id],
  );
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await json(await context.request.get("/api/tickets"), 401);
  assert(loggedInCookies.some((c) => c.name.endsWith("session_token")));
  pass(
    "saved browser session persists; expired server-side session redirects to login and denies APIs",
  );
  await page.goto("/register");
  await expect(
    page.getByText("Demo validada correctamente", { exact: false }),
  ).toHaveCount(0);
  await page.goto("/login");
  await expect(
    page.getByText("La autenticación real se conectará después", {
      exact: false,
    }),
  ).toHaveCount(0);
  assert.deepEqual(errors, []);
  pass("login/register have no demo success; zero browser errors");
  await api.dispose();
  await context.close();
  await writeFile(
    "test-results/auth-e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        browserErrors: errors.length,
        mode: "next start / NODE_ENV=production / isolated PostgreSQL",
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile("test-results/auth-server.log", logs);
  throw error;
} finally {
  await browser?.close();
  app.kill();
  await new Promise((r) => {
    if (app.exitCode !== null) r();
    else app.once("exit", r);
  });
  await database.close();
}
