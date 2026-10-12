import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export async function legalReconciliationChecks({
  page,
  context,
  database,
  pass,
}) {
  const origin = new URL(page.url()).origin;
  const summaries = await (await context.request.get("/api/legal")).json();
  assert.equal(summaries.length, 2);
  for (const [path, slug] of [
    ["/privacy", "aviso-de-privacidad"],
    ["/terms", "terminos"],
  ]) {
    const document = await (
      await context.request.get(`/api/legal/${slug}`)
    ).json();
    assert.equal(document.status, "DRAFT");
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          document.kind,
          document.locale,
          document.version,
          document.effectiveDate,
          document.title,
          document.sections,
        ]),
      )
      .digest("hex");
    assert.equal(hash, document.contentHash);
    await page.goto(path);
    const displayed = await page
      .locator("article > section")
      .evaluateAll((sections) =>
        sections.map((section) => ({
          id: section.id,
          title: section.querySelector("h2").textContent,
          paragraphs: Array.from(section.querySelectorAll(":scope > p")).map(
            (p) => p.textContent,
          ),
          ...(section.querySelector("ul")
            ? {
                items: Array.from(section.querySelectorAll("li")).map(
                  (li) => li.textContent,
                ),
              }
            : {}),
        })),
      );
    assert.deepEqual(
      displayed,
      document.sections,
      "UI must render exact canonical content and lists",
    );
    await expect(
      page.getByText(`Versión ${document.version}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Documento en revisión. Aún no está publicado como versión definitiva y no puede aceptarse.",
        { exact: true },
      ),
    ).toBeVisible();
    assert.equal(
      await page
        .getByRole("button", { name: "Registrar mi aceptación" })
        .count(),
      0,
    );
    const response = await context.request.post("/api/legal/acceptances", {
      headers: { Origin: origin },
      data: {
        document: document.kind,
        version: document.version,
        contentHash: document.contentHash,
      },
    });
    assert.equal(response.status(), 409);
    assert.equal((await response.json()).code, "LEGAL_DOCUMENT_NOT_PUBLISHED");
  }
  const states = await (
    await context.request.get("/api/legal/acceptances")
  ).json();
  assert(
    states.every(
      (state) =>
        state.status === "DRAFT" && !state.acceptable && !state.accepted,
    ),
  );
  assert.equal(
    (
      await database.db.query(
        'SELECT COUNT(*)::int AS n FROM "LegalAcceptance"',
      )
    ).rows[0].n,
    0,
  );
  const unauthorized = await context.request.post("/api/legal/acceptances", {
    headers: { Origin: "https://foreign.example.test" },
    data: {},
  });
  assert.equal(unauthorized.status(), 403);
  const anonymous = await context.browser().newContext({ baseURL: origin });
  assert.equal(
    (await anonymous.request.get("/api/legal/acceptances")).status(),
    401,
  );
  await anonymous.close();
  pass(
    "real legal APIs and server-rendered pages share exact canonical sections/version/hash; DRAFT rejected, no acceptance written, session and origin enforced",
  );

  // Published UI is isolated: no source mutation, no fake production publication.
  const fixture = await context.newPage();
  const errors = [];
  fixture.on("pageerror", (error) => errors.push(error.message));
  const response = await context.request.get("/privacy");
  const csp = response.headers()["content-security-policy"];
  assert(csp.includes("script-src 'self'"));
  assert(csp.includes("connect-src 'self'"));
  assert(!csp.includes("unsafe-eval"));
  const styles = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) => links.map((link) => link.href));
  await fixture.route("**/__legal-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": csp },
      body: `<html lang="es"><head><title>Prueba legal aislada</title>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><div id="root"></div></body></html>`,
    }),
  );
  const document = {
    document: "TERMS",
    version: "synthetic-test-1",
    contentHash: "1".repeat(64),
  };
  let mode = "ready",
    accepted = false,
    posts = [];
  await fixture.route("**/api/legal/acceptances", async (route) => {
    if (route.request().method() === "GET") {
      if (mode === "signed-out")
        return route.fulfill({
          status: 401,
          json: { error: "Sesión requerida." },
        });
      return route.fulfill({
        json: [
          {
            ...document,
            status: "PUBLISHED",
            acceptable: true,
            accepted,
            acceptedAt: accepted ? "2026-10-09T12:00:00Z" : null,
          },
        ],
      });
    }
    posts.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (mode === "conflict")
      return route.fulfill({
        status: 409,
        json: {
          error: "internal text never rendered",
          code: "LEGAL_VERSION_OUTDATED",
        },
      });
    if (mode === "not-published")
      return route.fulfill({
        status: 409,
        json: { error: "internal", code: "LEGAL_DOCUMENT_NOT_PUBLISHED" },
      });
    if (mode === "validation")
      return route.fulfill({
        status: 400,
        json: {
          error: "Revisa los campos indicados.",
          fields: { contentHash: ["private"] },
        },
      });
    if (mode === "unknown")
      return route.fulfill({
        status: 503,
        json: { error: "SQL SELECT Prisma stack trace private" },
      });
    accepted = true;
    return route.fulfill({
      status: 201,
      json: { ...document, acceptedAt: "2026-10-09T12:00:00Z", created: true },
    });
  });
  await fixture.goto("/__legal-fixture");
  const bundle = await build({
    entryPoints: ["tests/legal-ui-harness.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "test-legal-link",
        setup(builder) {
          builder.onResolve({ filter: /^next\/link$/ }, () => ({
            path: "link",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "import {createElement} from 'react'; export default function Link(props) { return createElement('a', props); }",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  await fixture.addScriptTag({ content: bundle.outputFiles[0].text });
  const checkbox = fixture.getByRole("checkbox"),
    submit = fixture.getByRole("button", {
      name: "Registrar mi aceptación",
      exact: true,
    });
  await expect(submit).toBeDisabled();
  await checkbox.check();
  await submit.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(
    fixture.getByRole("status").filter({ hasText: "Aceptación registrada" }),
  ).toBeVisible();
  assert.deepEqual(posts, [document]);
  await fixture.evaluate(() => window.renderLegalFixture());
  await expect(
    fixture.getByRole("status").filter({ hasText: "Aceptación registrada" }),
  ).toBeVisible();
  assert.equal(await checkbox.count(), 0);
  pass(
    "isolated PUBLISHED acceptance UI requires explicit checkbox, echoes only canonical version/hash, locks double submit and restores server acceptance",
  );
  accepted = false;
  mode = "conflict";
  await fixture.evaluate(() => window.renderLegalFixture());
  await checkbox.check();
  await submit.click();
  await expect(fixture.getByRole("alert")).toHaveText(
    "El documento cambió. Revisa la versión vigente antes de aceptarla.",
  );
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeDisabled();
  await expect(submit).toBeDisabled();
  await expect(fixture.getByRole("alert")).toBeFocused();
  const before = posts.length;
  await expect(
    fixture.getByRole("button", { name: "Recargar documento vigente" }),
  ).toBeVisible();
  assert.equal(posts.length, before);
  for (const [next, message] of [
    [
      "not-published",
      "Este documento aún no está vigente y no puede aceptarse.",
    ],
    ["validation", "Revisa los campos indicados."],
    [
      "unknown",
      "No pudimos confirmar la aceptación. Consulta de nuevo su estado.",
    ],
  ]) {
    mode = next;
    await fixture.evaluate(() => window.renderLegalFixture());
    await checkbox.check();
    await submit.click();
    await expect(fixture.getByRole("alert")).toHaveText(message);
    await expect(submit).toBeDisabled();
  }
  mode = "signed-out";
  await fixture.evaluate(() => window.renderLegalFixture());
  await expect(
    fixture.getByRole("link", { name: "Inicia sesión" }),
  ).toBeVisible();
  mode = "ready";
  await fixture.evaluate(() => window.renderLegalFixture("DRAFT"));
  await expect(
    fixture.getByText("Este documento está en revisión y no puede aceptarse.", {
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(await submit.count(), 0);
  assert.deepEqual(errors, []);
  pass(
    "isolated legal UI handles 401, both 409s, validation and ambiguous failures safely, blocks repeats and never accepts DRAFT",
  );
  for (const width of [360, 390, 820, 1440]) {
    await fixture.setViewportSize({ width, height: 900 });
    await fixture.evaluate(() => window.renderLegalFixture());
    await expect(submit).toBeVisible();
    assert(
      await fixture.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const axe = await new AxeBuilder({ page: fixture })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      axe.violations.map((v) => v.id),
      [],
    );
  }
  await fixture.close();
  pass(
    "production CSP unchanged; legal acceptance keyboard/focus, Axe and mobile/tablet/desktop pass; analytics/provider publication are not simulated",
  );
}
