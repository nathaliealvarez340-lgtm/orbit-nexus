import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument } from "pdf-lib";
import { fiscalIntegrationChecks } from "./fiscal-integration-checks.mjs";

async function accessible(page, selector) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    result.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
    [],
  );
}
async function selectCode(page, label, code) {
  await page.getByRole("combobox", { name: label, exact: true }).fill(code);
  await expect(
    page.getByRole("option").filter({ hasText: code }).first(),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: label, exact: true })
    .press("ArrowDown");
  await page.getByRole("combobox", { name: label, exact: true }).press("Enter");
}

export async function fiscalUxChecks({ page, context, pass }) {
  // These scenarios exercise the real local application and its business APIs.
  const extractionRequests = [];
  const onRequest = (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/fiscal-(consents|extractions)/.test(request.url())
    )
      extractionRequests.push(request.url());
  };
  page.on("request", onRequest);
  await page.goto("/dashboard/fiscal-profile");
  const form = page.locator("form.fiscal-ui");
  const confirmation = form.getByRole("checkbox", {
    name: "Revisé y confirmo que mis datos fiscales son correctos.",
  });
  await expect(confirmation).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Leer y prellenar constancia" }),
  ).toBeDisabled();
  const consent = form.getByRole("checkbox", { name: /^Autorizo a ORBIT/ });
  await expect(consent).not.toBeChecked();
  await expect(
    page.getByRole("region", {
      name: "Constancia de Situación Fiscal",
      exact: true,
    }),
  ).toBeVisible();
  const csfPdf = await PDFDocument.create();
  csfPdf.addPage().drawText("SYNTHETIC LOCAL UI UPLOAD ONLY");
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/private-assets") &&
      response.request().method() === "POST",
  );
  await form.locator('input[type="file"]').setInputFiles({
    name: "replacement-csf.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await csfPdf.save()),
  });
  const uploadedResponse = await uploadResponse;
  assert.equal(uploadedResponse.status(), 201);
  const uploadedCsf = await uploadedResponse.json();
  await expect(consent).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Leer y prellenar constancia" }),
  ).toBeDisabled();
  await form
    .getByLabel("Razón social", { exact: true })
    .fill("Emisor local revisado");
  await confirmation.check();
  await form.getByLabel("Código postal fiscal", { exact: true }).fill("06010");
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/fiscal-profile") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Confirmar y guardar perfil" })
    .click();
  const profileResponse = await saved;
  assert.equal(profileResponse.status(), 200);
  assert.equal(
    profileResponse.request().postDataJSON().csfDocumentId,
    uploadedCsf.id,
  );
  const persistedProfile = await context.request.get("/api/fiscal-profile");
  assert.equal(persistedProfile.status(), 200);
  assert.equal((await persistedProfile.json()).csfDocumentId, uploadedCsf.id);
  await expect(
    form
      .getByRole("status")
      .filter({ hasText: "✓ Información guardada correctamente" }),
  ).toBeVisible();
  assert.equal(extractionRequests.length, 0);
  pass(
    "5C profile manual save, unchecked/reset confirmation, CSF first, pending extraction causes no processing request",
  );

  await page.goto("/dashboard/clients");
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  await expect(page.locator('input[name="rfc"]')).toBeFocused();
  await expect(
    page.getByRole("region", { name: "Constancia opcional del cliente" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /^Declaro que cuento/ }),
  ).not.toBeChecked();
  await page.locator('input[name="rfc"]').fill("CCC010101CCC");
  await page.locator('input[name="legalName"]').fill("Cliente manual Fase 5C");
  await page.locator('input[name="postalCode"]').fill("06000");
  await page.locator('input[name="email"]').fill("client-5c@example.test");
  await selectCode(page, "Régimen fiscal", "601");
  await expect(page.locator('input[name="cfdiUse"]')).toHaveValue("");
  await selectCode(page, "Uso CFDI", "G03");
  await page
    .getByRole("checkbox", {
      name: "Revisé y confirmo que los datos fiscales del cliente son correctos.",
    })
    .check();
  const clientSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/clients") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Guardar cliente", exact: true })
    .click();
  assert.equal((await clientSaved).status(), 201);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "✓ Información guardada correctamente" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nuevo cliente" }),
  ).toBeFocused();
  const row = page
    .getByRole("row")
    .filter({ hasText: "Cliente manual Fase 5C" });
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Régimen fiscal", exact: true }),
  ).toHaveValue(/601 ·/);
  await page
    .getByRole("combobox", { name: "Régimen fiscal", exact: true })
    .fill("sin-coincidencias");
  await expect(
    page.getByRole("status").filter({ hasText: "Sin coincidencias" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("combobox", { name: "Régimen fiscal", exact: true }),
  ).toHaveValue(/601 ·/);
  await accessible(page, ".fiscal-ui");
  await page
    .locator('input[name="legalName"]')
    .fill("Cliente manual Fase 5C revisado");
  await page
    .getByRole("checkbox", {
      name: "Revisé y confirmo que los datos fiscales del cliente son correctos.",
    })
    .check();
  const patched = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/clients/"),
  );
  await page
    .getByRole("button", { name: "Guardar cliente", exact: true })
    .click();
  const patchResponse = await patched;
  assert.equal(patchResponse.status(), 200);
  const patchBody = patchResponse.request().postDataJSON();
  assert.equal("organizationId" in patchBody, false);
  assert.equal("id" in patchBody, false);
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Editar", exact: true }),
  ).toBeFocused();
  pass(
    "5C clients real create without CSF, separate controlled regime/CFDI use, catalog keyboard/empty/Escape and focus restoration",
  );

  await fiscalIntegrationChecks({ page, context, pass });
  for (const width of [1440, 1280, 820, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard/fiscal-profile");
    await page
      .getByRole("button", { name: "Preferencias de cookies", exact: true })
      .click();
    const cookies = page.getByRole("region", {
      name: "Preferencias de cookies",
    });
    await expect(cookies).toBeVisible();
    if (width >= 1024) {
      const sidebar = page.getByRole("complementary", {
        name: "Navegación de escritorio",
      });
      const invoices = sidebar.getByRole("button", {
        name: "Facturas",
        exact: true,
      });
      await invoices.focus();
      await page.keyboard.press("Enter");
      await expect(sidebar).toHaveAttribute("data-expanded", "true");
      await invoices.click();
      await expect(sidebar).toHaveAttribute("data-expanded", "true");
      await page
        .getByRole("heading", { name: "Perfil fiscal", exact: true })
        .click();
      await expect(sidebar).toHaveAttribute("data-expanded", "false");
      await invoices.click();
      await sidebar
        .getByRole("link", { name: "Clientes", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/dashboard\/clients$/);
      await expect(sidebar).toHaveAttribute("data-expanded", "false");
      const railBox = await sidebar.boundingBox(),
        cookieBox = await cookies.boundingBox();
      assert(railBox.y + railBox.height <= cookieBox.y);
    } else {
      await page
        .getByRole("button", { name: "Abrir menú", exact: true })
        .click();
      const menu = page.getByRole("dialog", { name: "Menú de navegación" });
      await expect(
        menu.getByRole("region", { name: "Preferencias de cookies" }),
      ).toBeVisible();
      await menu
        .getByRole("button", { name: "Rechazar no esenciales" })
        .click();
      await expect(
        menu.getByRole("button", {
          name: "Preferencias de cookies",
          exact: true,
        }),
      ).toBeVisible();
      await menu.getByRole("button", { name: "Facturas", exact: true }).click();
      await expect(menu).toBeVisible();
      await menu.getByRole("link", { name: "Clientes", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/clients$/);
      await expect(menu).not.toBeVisible();
      await page
        .getByRole("button", { name: "Abrir menú", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(menu).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "Abrir menú", exact: true }),
      ).toBeFocused();
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await accessible(page, ".orbit-app");
    if (
      await page
        .getByRole("button", { name: "Rechazar no esenciales" })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "Rechazar no esenciales" })
        .click();
    await page.goto("/dashboard/fiscal-profile");
    await page
      .getByRole("combobox", { name: "Régimen fiscal", exact: true })
      .click();
    await expect(
      page.getByRole("listbox", { name: "Régimen fiscal" }),
    ).toBeVisible();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/fiscal-ux-${width}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".orbit-sidebar")).toHaveCSS(
    "transition-duration",
    "1e-05s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  page.off("request", onRequest);
  pass(
    "5C navigation/cookies/forms: 1440,1280,820,390,360; desktop collapse semantics, mobile top layer, keyboard, Axe and reduced motion",
  );

  await extractionUiChecks(context, pass);
}

export async function extractionUiChecks(context, pass) {
  // Separate page and in-memory bundle: only this harness injects fixture ports.
  const fixture = await context.newPage();
  const fixtureErrors = [];
  fixture.on("pageerror", (error) => fixtureErrors.push(error.message));
  const bundled = await build({
    entryPoints: ["tests/fiscal-ui-harness.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "test-router-boundary",
        setup(builder) {
          builder.onResolve(
            { filter: /^next\/(link|navigation)$/ },
            (args) => ({ path: args.path, namespace: "test-router" }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "test-router" },
            (args) => ({
              contents:
                args.path === "next/navigation"
                  ? "export const useRouter = () => ({ refresh() {} });"
                  : "import {createElement} from 'react'; export default function Link(props) { return createElement('a', props); }",
              resolveDir: process.cwd(),
            }),
          );
        },
      },
    ],
  });
  const style = await readFile("src/components/fiscal/fiscal.css", "utf8");
  const dashboardStyle = await readFile(
    "src/app/dashboard/dashboard.css",
    "utf8",
  );
  await fixture.setContent(
    `<html lang="es"><head><title>Prueba fiscal aislada</title><style>body{margin:0;background:#0c0c0f;color:white;font-family:Arial}.input{box-sizing:border-box;width:100%;padding:12px;color:white;background:#18181b;border:1px solid #555}fieldset{border:0}button{color:white;background:#18181b;border:1px solid #555;border-radius:8px}button:disabled{opacity:.5}label{display:block} .grid{display:grid;gap:16px} ${dashboardStyle} ${style}</style></head><body><div id="fixture-root"></div></body></html>`,
  );
  await fixture.addScriptTag({ content: bundled.outputFiles[0].text });
  await expect(
    fixture.getByRole("heading", { name: /Prueba aislada/ }),
  ).toBeVisible();
  const upload = () =>
    fixture.locator('input[type="file"]').setInputFiles({
      name: "test.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("isolated synthetic upload"),
    });
  await upload();
  await expect(
    fixture
      .getByRole("status")
      .filter({ hasText: "Cargando documento privado" }),
  ).toBeVisible();
  const authorization = fixture.getByRole("checkbox", {
    name: /^Autorización sintética/,
  });
  await expect(authorization).not.toBeChecked();
  const read = fixture.getByRole("button", {
    name: "Leer y prellenar constancia",
  });
  await expect(read).toBeDisabled();
  assert.deepEqual(await fixture.evaluate(() => window.fiscalUiTest.calls), [
    "upload",
  ]);
  await authorization.check();
  await read.evaluate((element) => {
    element.click();
    element.click();
  });
  await expect(
    fixture.getByRole("status").filter({ hasText: /Registrando autorización/ }),
  ).toBeVisible();
  await expect(
    fixture.getByRole("region", { name: "Revisión de información detectada" }),
  ).toBeVisible();
  assert.deepEqual(await fixture.evaluate(() => window.fiscalUiTest.calls), [
    "upload",
    "consent",
    "extract",
  ]);
  await expect(fixture.getByLabel("Razón social", { exact: true })).toHaveValue(
    "Nombre actual de prueba",
  );
  await expect(
    fixture.getByText("Lectura poco clara · requiere revisión", {
      exact: true,
    }),
  ).toBeVisible();
  for (const radio of await fixture.getByRole("radio").all())
    await expect(radio).not.toBeChecked();
  await expect(fixture.getByRole("radio", { name: /603/ })).toBeDisabled();
  await expect(
    fixture.getByText(
      "Selecciona el régimen en el catálogo del formulario; esta lectura no lo valida.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(fixture.locator('input[name="fiscalRegime"]')).toHaveValue(
    "601",
  );
  await expect(
    fixture.getByRole("checkbox", { name: /^Revisé y confirmo/ }),
  ).toBeDisabled();
  await fixture
    .getByRole("button", { name: "Usar en Nombre / razón social", exact: true })
    .click();
  await fixture
    .getByLabel("Razón social", { exact: true })
    .fill("Nombre corregido manualmente");
  await fixture.getByRole("radio", { name: /601/ }).check();
  const confirm = fixture.getByRole("checkbox", { name: /^Revisé y confirmo/ });
  await expect(confirm).not.toBeChecked();
  await expect(fixture.locator('input[name="cfdiUse"]')).toHaveValue("G03");
  await confirm.check();
  await fixture
    .getByLabel("Código postal fiscal", { exact: true })
    .fill("06010");
  await expect(confirm).not.toBeChecked();
  await confirm.check();
  await fixture
    .getByRole("button", { name: "Confirmar y guardar perfil" })
    .click();
  await expect(
    fixture
      .getByRole("status")
      .filter({ hasText: "✓ Información guardada correctamente" }),
  ).toBeVisible();
  const captured = await fixture.evaluate(() => window.fiscalUiTest.saved);
  assert.equal(captured.extractionId, "test-extraction");
  assert.equal(captured.legalName, "Nombre corregido manualmente");
  assert.equal(captured.confirmed, true);
  await upload();
  await expect(authorization).not.toBeChecked();
  await expect(
    fixture.getByRole("region", { name: "Revisión de información detectada" }),
  ).toHaveCount(0);
  await fixture.evaluate(() => {
    window.fiscalUiTest.mode = "error";
  });
  await authorization.check();
  await read.click();
  await expect(fixture.getByRole("alert")).toContainText(
    "No pudimos leer la constancia",
  );
  await expect(fixture.getByRole("alert")).not.toContainText(
    "Synthetic internal",
  );
  await fixture.evaluate(() => {
    window.fiscalUiTest.mode = "mismatch";
  });
  await read.click();
  await expect(fixture.getByRole("alert")).toContainText(
    "No pudimos leer la constancia",
  );
  await expect(
    fixture.getByRole("region", { name: "Revisión de información detectada" }),
  ).toHaveCount(0);
  await fixture.evaluate(() => {
    window.fiscalUiTest.mode = "unreadable";
  });
  await read.click();
  await expect(
    fixture.getByText(
      "No pudimos identificar todos los datos de tu Constancia. Puedes revisarlos y completarlos manualmente.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.deepEqual(fixtureErrors, []);
  await fixture.close();
  pass(
    "5C isolated typed fixtures: upload/loading/consent sequencing, double click, partial/low-confidence/ambiguous/multiple regimes, comparison, explicit application/correction/confirmation, safe errors and mismatched documents; no stamping",
  );
}
