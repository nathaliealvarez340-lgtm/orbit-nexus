import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";

export async function webPrivacyChecks({ page, context, pass }) {
  const requests = [];
  page.on("request", (r) => {
    if (r.url().includes("/_vercel/insights")) requests.push(r.url());
  });
  // Isolated SDK harness: exercises the real installed SDK's script injection,
  // queue and beforeSend. No external Vercel endpoint or private business data.
  await context.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    window.privacyAnalytics = {events: [], beforeSend: null};
    const receive = (kind, data) => {
      if (kind === 'beforeSend') { window.privacyAnalytics.beforeSend = data; return; }
      const payload = kind === 'pageview' ? {type:'pageview',url:location.origin + data.path} : {type:'event',url:location.href};
      const filtered = window.privacyAnalytics.beforeSend?.(payload);
      if (filtered) window.privacyAnalytics.events.push(filtered);
    };
    window.va = receive; for (const [kind, data] of window.vaq || []) receive(kind, data); window.vaq = [];
  `,
    }),
  );
  await context.clearCookies({ name: "orbit.consent" });
  // Activation is off in the real app. This explicitly enabled, isolated component
  // harness verifies the installed SDK against the app's actual production CSP.
  const analyticsFixture = await context.newPage();
  analyticsFixture.on("request", (r) => {
    if (r.url().includes("/_vercel/insights")) requests.push(r.url());
  });
  const csp = (await context.request.get("/privacy")).headers()[
    "content-security-policy"
  ];
  await context.route("**/__analytics-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": csp },
      body: '<html lang="es"><head><title>Prueba aislada de SDK</title></head><body><div id="root"></div></body></html>',
    }),
  );
  await analyticsFixture.goto("/__analytics-fixture");
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProductAnalytics} from './src/components/privacy/product-analytics'; createRoot(document.getElementById('root')).render(<ProductAnalytics enabled={true}/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "isolated-analytics-path",
        setup(builder) {
          builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "next/navigation",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const usePathname = () => '/privacy';",
          }));
        },
      },
    ],
  });
  await analyticsFixture.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: "Aviso de Privacidad", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Preferencias de cookies" }),
  ).toBeVisible();
  assert.equal(requests.length, 0, "No analytics request before a choice");
  await page
    .getByRole("button", { name: "Rechazar analíticas", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Preferencias de cookies", exact: true }),
  ).toBeVisible();
  assert.equal(requests.length, 0);
  await page
    .getByRole("button", { name: "Preferencias de cookies", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /ANALYTICS/ }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: /ANALYTICS/ }).check();
  await page.getByRole("button", { name: "Aceptar selección" }).click();
  assert.equal(
    await page.locator('script[src*="/_vercel/insights"]').count(),
    0,
    "Pending activation must not load the provider in the app",
  );
  await analyticsFixture.evaluate(() =>
    window.dispatchEvent(new Event("focus")),
  );
  await expect.poll(() => requests.length).toBe(1);
  const consent = JSON.parse(
    decodeURIComponent(
      (await context.cookies()).find((c) => c.name === "orbit.consent").value,
    ),
  );
  assert.deepEqual(Object.keys(consent).sort(), [
    "analytics",
    "chosenAt",
    "necessary",
    "version",
  ]);
  assert.equal(consent.analytics, true);
  assert.equal(consent.necessary, true);
  assert.equal(consent.version, "2");
  assert(Number.isFinite(Date.parse(consent.chosenAt)));
  await expect
    .poll(() =>
      analyticsFixture.evaluate(() => window.privacyAnalytics?.events.length),
    )
    .toBe(1);
  const payload = await analyticsFixture.evaluate(() =>
    window.privacyAnalytics.beforeSend({
      type: "pageview",
      url: location.origin + "/dashboard/reports?invoiceId=private#rfc",
      data: { email: "private" },
    }),
  );
  assert.deepEqual(payload, {
    type: "pageview",
    url: new URL("/dashboard/reports", page.url()).href,
  });
  assert.equal(
    await analyticsFixture.evaluate(() =>
      window.privacyAnalytics.beforeSend({
        type: "pageview",
        url: location.origin + "/reset-password?token=private",
      }),
    ),
    null,
  );
  assert.equal(
    await analyticsFixture.evaluate(() =>
      window.privacyAnalytics.beforeSend({ type: "event", url: location.href }),
    ),
    null,
  );
  await page
    .getByRole("button", { name: "Preferencias de cookies", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /ANALYTICS/ })).toBeChecked();
  await page
    .getByRole("button", { name: "Rechazar analíticas", exact: true })
    .click();
  assert.equal(
    await analyticsFixture.evaluate(() =>
      window.privacyAnalytics.beforeSend({
        type: "pageview",
        url: location.origin + "/privacy",
      }),
    ),
    null,
    "Already loaded SDK must not send after revocation",
  );
  await analyticsFixture.close();
  await context.unroute("**/__analytics-fixture");
  pass(
    "web consent: zero pre-choice/rejected requests, persistence, explicit opt-in, safe payload and immediate revocation of loaded SDK",
  );
  await page.goto("/cookies");
  await page
    .getByRole("button", { name: "Cambiar preferencias de cookies" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tu privacidad en Orbit" }),
  ).toBeFocused();
  await page
    .getByRole("heading", { name: "Tu privacidad en Orbit" })
    .press("Escape");
  await expect(
    page.getByRole("button", { name: "Cambiar preferencias de cookies" }),
  ).toBeFocused();
  await context.addCookies([
    {
      name: "orbit.consent",
      value: encodeURIComponent(
        JSON.stringify({
          version: 1,
          necessary: true,
          analytics: true,
          marketing: true,
        }),
      ),
      url: new URL(page.url()).origin,
    },
  ]);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Preferencias de cookies" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Rechazar analíticas", exact: true })
    .click();
  pass(
    "cookie preferences reopen from policy, keyboard Escape restores focus; obsolete policy requests new choice",
  );

  for (const [path, title] of [
    ["/", "Operación financiera y fiscal"],
    ["/login", "Iniciar sesión"],
    ["/register", "Crear cuenta"],
    ["/forgot-password", "Recuperar acceso"],
    ["/privacy", "Aviso de Privacidad"],
    ["/terms", "Términos y Condiciones"],
    ["/cookies", "Cookies y preferencias"],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(new RegExp(title));
    assert.equal(
      new URL(await page.locator('link[rel="canonical"]').getAttribute("href"))
        .pathname,
      path,
    );
    assert(await page.locator('meta[property="og:title"]').count());
    if (["/privacy", "/terms"].includes(path)) {
      assert(
        (
          await page.locator('meta[name="robots"]').getAttribute("content")
        ).includes("noindex"),
      );
      await expect(page.locator('[data-legal-status="DRAFT"]')).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Registrar mi aceptación" }),
      ).toHaveCount(0);
    }
    if (path !== "/") {
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          targets: v.nodes.map((n) => n.target),
        })),
        [],
        `Axe ${path}`,
      );
    }
  }
  const sitemap = await (await context.request.get("/sitemap.xml")).text();
  assert(sitemap.includes("/cookies"));
  for (const path of ["/privacy", "/terms"])
    assert(
      !sitemap.includes(path),
      "Draft must be absent from sitemap: " + path,
    );
  assert(!/dashboard|reset-password|onboarding|\/api\//.test(sitemap));
  const robots = await (await context.request.get("/robots.txt")).text();
  for (const path of ["/dashboard", "/api/", "/reset-password", "/onboarding"])
    assert(robots.includes("Disallow: " + path));
  for (const path of [
    "/dashboard",
    "/onboarding",
    "/reset-password?token=synthetic-test-only",
  ]) {
    await page.goto(path);
    assert(
      (
        await page.locator('meta[name="robots"]').getAttribute("content")
      ).includes("noindex"),
    );
  }
  pass(
    "public titles/canonicals/OG, public-only sitemap, robots exclusions, private noindex and public Axe checks",
  );

  await page.goto("/login");
  let sends = 0;
  await page.route("**/api/auth/sign-in/email", async (route) => {
    sends++;
    await new Promise((r) => setTimeout(r, 250));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "SQL stack: SELECT private account" }),
    });
  });
  await page.locator('input[name="email"]').fill("synthetic@example.test");
  await page.locator('input[name="password"]').fill("SyntheticFailure123");
  await page.locator("form").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "No se pudo iniciar sesión",
  );
  assert.equal(sends, 1);
  await expect(page.locator('input[name="email"]')).toHaveValue(
    "synthetic@example.test",
  );
  await expect(page.locator("form").getByRole("alert")).toBeFocused();
  assert(
    !(await page
      .locator("form")
      .getByRole("alert")
      .innerText()
      .then((text) => text.includes("SELECT"))),
  );
  await page.unroute("**/api/auth/sign-in/email");
  await page.goto("/register");
  await page.locator('input[name="name"]').fill("Prueba UI");
  await page.locator('input[name="email"]').fill("synthetic@example.test");
  await page.locator('input[name="password"]').fill("SyntheticPassword123");
  await page.locator('input[name="confirm"]').fill("DifferentPassword123");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page.locator('input[name="confirm"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator('input[name="confirm"]')).toBeFocused();
  assert(
    await page
      .locator('input[name="confirm"]')
      .getAttribute("aria-describedby"),
  );
  await page.goto("/forgot-password");
  await page.route("**/api/auth/request-password-reset", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"SQL hidden"}',
    }),
  );
  await page.locator('input[name="email"]').fill("synthetic@example.test");
  await page.getByRole("button", { name: "Solicitar recuperación" }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page.locator('input[name="email"]')).toHaveValue(
    "synthetic@example.test",
  );
  await page.unroute("**/api/auth/request-password-reset");
  await page.goto("/reset-password?token=synthetic-only");
  await page.route("**/api/auth/reset-password", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"SQL hidden"}',
    }),
  );
  await page.locator('input[name="password"]').fill("SyntheticPassword123");
  await page.locator('input[name="confirm"]').fill("SyntheticPassword123");
  await page.getByRole("button", { name: "Actualizar contraseña" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "No fue posible completar",
  );
  await expect(page.locator('input[name="password"]')).toHaveValue(
    "SyntheticPassword123",
  );
  await page.unroute("**/api/auth/reset-password");
  await page.goto("/onboarding");
  await page.route("**/api/organizations", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Revisa los campos indicados.",
        fields: { name: ["SQL hidden"] },
      }),
    }),
  );
  await page.locator('input[name="name"]').fill("Organización de QA");
  await page
    .getByRole("button", { name: "Crear organización", exact: true })
    .click();
  await expect(page.locator('input[name="name"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator('input[name="name"]')).toBeFocused();
  await expect(page.locator('input[name="name"]')).toHaveValue(
    "Organización de QA",
  );
  await page.unroute("**/api/organizations");
  await page.goto("/dashboard/fiscal-profile");
  const fiscal = page.locator("form.fiscal-ui");
  await fiscal
    .getByRole("checkbox", {
      name: "Revisé y confirmo que mis datos fiscales son correctos.",
    })
    .check();
  await page.route("**/api/fiscal-profile", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Revisa los campos indicados.",
        fields: { rfc: ["SQL hidden"] },
      }),
    }),
  );
  await fiscal
    .getByRole("button", { name: "Confirmar y guardar perfil" })
    .click();
  await expect(fiscal.locator('input[name="rfc"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(fiscal.locator('input[name="rfc"]')).toBeFocused();
  await expect(fiscal.locator('input[name="rfc"]')).toHaveValue("AAA010101AAA");
  await page.unroute("**/api/fiscal-profile");
  pass(
    "critical login/register/recovery/reset/onboarding/fiscal forms: safe failures, preserved input, double-submit lock, associated field error and focus",
  );

  for (const width of [360, 390, 430, 768, 820, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/login",
      "/register",
      "/forgot-password",
      "/privacy",
      "/terms",
      "/cookies",
      "/dashboard",
      "/dashboard/fiscal-profile",
      "/dashboard/clients",
      "/dashboard/invoices/new",
      "/dashboard/reports",
    ]) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      if (path === "/dashboard/invoices/new")
        await expect(
          page.getByRole("button", { name: "Guardar borrador" }),
        ).toBeVisible();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${path} overflow at ${width}`,
      );
      await page.screenshot({
        path: `test-results/privacy-${path.replaceAll("/", "-") || "home"}-${width}.png`,
        fullPage: true,
      });
    }
    await page.goto("/dashboard/fiscal-profile");
    if (width < 1024) {
      await page.getByRole("button", { name: "Abrir menú" }).click();
      const menu = page.getByRole("dialog", { name: "Menú de navegación" });
      await expect(menu).toBeVisible();
      await menu
        .getByRole("button", { name: "Preferencias de cookies", exact: true })
        .click();
      await expect(
        menu.getByRole("region", { name: "Preferencias de cookies" }),
      ).toBeVisible();
      await menu
        .getByRole("button", { name: "Rechazar analíticas", exact: true })
        .click();
      await menu.getByRole("button", { name: "Cerrar menú" }).click();
      await expect(menu).not.toBeVisible();
    }
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        targets: v.nodes.map((n) => n.target),
      })),
      [],
      `Fiscal/shell Axe ${width}`,
    );
    pass(
      `responsive ${width}: auth/legal/dashboard/fiscal/clients/Invoice Studio/reports; screenshots, no overflow, shell Axe and mobile menu/cookies`,
    );
  }
}
