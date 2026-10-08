import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startDatabase } from "../scripts/local-database.mjs";
import {
  contextFixture,
  evaluationFixture,
  conceptErrorFixture,
} from "./invoice-studio-fixtures.mjs";
const expect = playwrightExpect.configure({ timeout: 20000 });

// Real local auth/tenant/plan; only missing Fase 5 APIs are browser fixtures.
const database = await startDatabase(),
  baseURL = "http://localhost:3101";
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
      DATABASE_URL: database.url,
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      MAIL_API_URL: "",
      MAIL_API_TOKEN: "",
      OCR_API_URL: "",
      OCR_API_TOKEN: "",
      NODE_USE_SYSTEM_CA: "1",
    },
  },
);
let browser,
  logs = "";
app.stdout.on("data", (buffer) => {
  logs += buffer.toString();
});
app.stderr.on("data", (buffer) => {
  logs += buffer.toString();
});
const checks = [];
const pass = (label) => {
  checks.push(label);
  console.log("PASS " + label);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (logs.includes("Ready in")) break;
    if (app.exitCode !== null)
      throw new Error("Local dev server exited before startup.");
    await pause(500);
  }
  assert(logs.includes("Ready in"), "Local dev server must start on 3101");
  browser = await chromium.launch({
    headless: true,
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.platform === "win32" ? "msedge" : undefined),
  });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = { Origin: baseURL };
  const password = randomBytes(24).toString("base64url") + "-9aZ";
  const response = await context.request.post("/api/auth/sign-up/email", {
    headers: origin,
    data: { name: "Studio QA", email: "studio-qa@example.test", password },
  });
  assert.equal(response.status(), 200);
  const companyResponse = await context.request.post("/api/organizations", {
    headers: origin,
    data: { name: "Studio local QA" },
  });
  assert.equal(companyResponse.status(), 201);
  const organization = await companyResponse.json();
  await page.goto("/dashboard/invoices/new");
  await page.getByRole("button", { name: "Rechazar no esenciales" }).click();
  await expect(
    page.getByRole("heading", { name: "Facturas · PRO / MAX" }),
  ).toBeVisible();
  pass("existing server-side FREE plan gating remains active");
  await database.db.query(
    'INSERT INTO "Subscription" ("organizationId",plan,"updatedAt") VALUES ($1,$2,NOW())',
    [organization.id, "PRO"],
  );
  await page.goto("/dashboard/invoices/new");
  await expect(
    page.getByRole("heading", {
      name: "Invoice Studio está pendiente de integración",
    }),
  ).toBeVisible();
  pass(
    "real missing context endpoint shows integration dependency without fabricated data",
  );

  let stored,
    sequence = 0,
    posts = 0,
    patches = 0,
    readyRequests = 0;
  let currentEvaluation = evaluationFixture,
    conflict = false,
    delayNextValidation = false,
    validationStarted = false;
  let latestPost, latestPatch;
  await page.route("**/api/outgoing-invoices/context", (route) =>
    route.fulfill({ json: contextFixture }),
  );
  await page.route("**/api/fiscal-catalogs/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith("productCode")
        ? [{ code: "01010101", label: "Servicios de prueba", active: true }]
        : [{ code: "ACT", label: "Actividad", active: true }],
    });
  });
  await page.route("**/api/outgoing-invoices/validate", async (route) => {
    const result = structuredClone(currentEvaluation);
    if (delayNextValidation) {
      delayNextValidation = false;
      validationStarted = true;
      await pause(1600);
    }
    await route.fulfill({ json: result }).catch(() => {});
  });
  await page.route(
    /\/api\/outgoing-invoices(?:\/studio-draft(?:\/ready)?)?$/,
    async (route) => {
      const request = route.request(),
        method = request.method(),
        path = new URL(request.url()).pathname;
      if (method === "GET") {
        await route.fulfill({ json: stored });
        return;
      }
      if (path.endsWith("/ready")) {
        readyRequests++;
        stored.status = "READY";
        stored.updatedAt = `2026-10-07T12:00:${String(++sequence).padStart(2, "0")}.000Z`;
        await route.fulfill({
          json: { validation: currentEvaluation.validation, status: "READY" },
        });
        return;
      }
      const input = request.postDataJSON();
      if (method === "PATCH") {
        patches++;
        latestPatch = input;
        if (conflict) {
          await route.fulfill({
            status: 409,
            json: { error: "El borrador cambió en otra pestaña." },
          });
          return;
        }
        assert.equal(input.expectedUpdatedAt, stored.updatedAt);
      } else {
        posts++;
        latestPost = input;
        assert(
          request.headers()["idempotency-key"],
          "create sends a stable deduplication key",
        );
      }
      assert.equal("organizationId" in input, false);
      assert.equal("totals" in input, false);
      assert.equal("status" in input, false);
      stored = {
        ...input,
        ...structuredClone(currentEvaluation),
        id: "studio-draft",
        folio: "ORB-000001",
        status: "DRAFT",
        issuerSnapshot: contextFixture.issuer,
        receiverSnapshot: contextFixture.clients.find(
          (client) => client.id === input.clientId,
        ),
        updatedAt: `2026-10-07T12:00:${String(++sequence).padStart(2, "0")}.000Z`,
      };
      await route.fulfill({
        status: method === "PATCH" ? 200 : 201,
        json: stored,
      });
    },
  );
  await page.getByRole("button", { name: "Volver a cargar" }).click();
  await expect(
    page.getByLabel("Cliente receptor", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Cliente receptor", { exact: true })
    .fill("Cliente de prueba");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByText("BBB010101BBB", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Cliente receptor", { exact: true }),
  ).toHaveValue("Cliente de prueba · BBB010101BBB");
  await expect(page.getByLabel("Forma de pago", { exact: true })).toHaveValue(
    /03/,
  );
  await expect(
    page.getByLabel("Tipo de comprobante").locator('option[value="E"]'),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Tipo de comprobante").locator('option[value="T"]'),
  ).toBeDisabled();
  await page.getByLabel("Fecha", { exact: true }).fill("2026-10-07");
  await page.getByLabel("Exportación", { exact: true }).selectOption("01");
  await page
    .getByLabel("Descripción · Concepto 1", { exact: true })
    .fill("Servicio capturado");
  await page
    .getByLabel("Precio unitario · Concepto 1", { exact: true })
    .fill("100.00");
  await page
    .getByLabel("Clave producto/servicio · Concepto 1", { exact: true })
    .fill("Servicios");
  await expect(
    page.getByRole("option", { name: /Servicios de prueba/ }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page
    .getByLabel("Unidad · Concepto 1", { exact: true })
    .fill("Actividad");
  await expect(page.getByRole("option", { name: /Actividad/ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page
    .getByText("Impuestos y retenciones · Pendiente", { exact: true })
    .click();
  await page
    .getByLabel("Objeto de impuesto · Concepto 1", { exact: true })
    .selectOption("02");
  const vatInput = page.getByLabel("IVA · Concepto 1", { exact: true });
  await vatInput.fill("10");
  await vatInput.pressSequentially(".6667");
  await expect(vatInput).toHaveValue("10.6667");
  await vatInput.fill("16");
  await expect(
    page.getByRole("button", { name: "Eliminar concepto 1" }),
  ).toBeDisabled();
  pass(
    "explicit client selection, client defaults, searchable SAT keys, keyboard and unsupported E/T controls",
  );

  await page
    .getByLabel("Agregar concepto guardado")
    .fill("Servicio profesional");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Descripción · Concepto 2")).toHaveValue(
    "Servicio del catálogo",
  );
  await page.getByLabel("Descripción · Concepto 2").fill("Copia modificada");
  assert.equal(
    contextFixture.savedConcepts[0].description,
    "Servicio del catálogo",
  );
  await page.getByRole("button", { name: "Eliminar concepto 2" }).click();
  await expect(page.getByLabel("Descripción · Concepto 1")).toBeFocused();
  pass(
    "saved concepts create independent editable snapshots; removal restores focus and preserves last line",
  );

  await expect(
    page.getByText("Datos listos para revisión.", { exact: true }),
  ).toBeVisible();
  delayNextValidation = true;
  validationStarted = false;
  await page
    .getByRole("button", { name: "Validar datos", exact: true })
    .click();
  await expect.poll(() => validationStarted).toBe(true);
  currentEvaluation = conceptErrorFixture;
  await page.getByLabel("Descripción · Concepto 1").fill("Nueva captura");
  await expect(
    page.getByRole("button", {
      name: /Agrega una descripción para este concepto/,
    }),
  ).toBeVisible();
  await pause(1800);
  await expect(
    page.getByText("Datos listos para revisión.", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /Agrega una descripción para este concepto/ })
    .click();
  await expect(page.getByLabel("Descripción · Concepto 1")).toBeFocused();
  await expect(page.getByLabel("Descripción · Concepto 1")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  pass(
    "server issues navigate to their line/field; outdated validation never validates new input",
  );

  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .dblclick();
  await expect(
    page.getByText(
      "Borrador guardado. Puedes continuar editando o revisar el documento.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(posts, 1);
  assert.equal(latestPost.concepts[0].vatRate, "0.16");
  await page
    .getByRole("button", { name: "Revisión final", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Marcar borrador como listo" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Documento aún no timbrado", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Seguir editando" }).click();
  await expect(
    page.getByRole("button", { name: "Revisión final", exact: true }),
  ).toBeFocused();
  pass(
    "fiscal errors allow saving DRAFT; double-submit is locked; review cannot mark an invalid draft READY",
  );

  currentEvaluation = evaluationFixture;
  await page.getByLabel("Descripción · Concepto 1").fill("Servicio corregido");
  await expect(
    page.getByText("Datos listos para revisión.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .click();
  await expect(
    page.getByText(
      "Borrador guardado. Puedes continuar editando o revisar el documento.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(posts, 1);
  assert.equal(patches, 1);
  assert(latestPatch.expectedUpdatedAt);
  await page
    .getByRole("button", { name: "Revisión final", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Marcar borrador como listo" })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Borrador listo para revisión. Documento aún no timbrado.", {
        exact: true,
      }),
  ).toBeVisible();
  assert.equal(readyRequests, 1);
  assert.equal(stored.status, "READY");
  assert.equal(stored.uuid, undefined);
  const reviewAxe = await new AxeBuilder({ page })
    .include("dialog[open]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    reviewAxe.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
    [],
  );
  await page.getByRole("button", { name: "Seguir editando" }).click();
  pass(
    "PATCH reuses folio with concurrency token; READY is confirmed by server detail and never ISSUED; review passes Axe",
  );

  await page.goto("/dashboard/invoices/new?draft=studio-draft");
  await expect(page.getByLabel("Descripción · Concepto 1")).toHaveValue(
    "Servicio corregido",
  );
  await page
    .getByLabel("Descripción · Concepto 1")
    .fill("Cambio después de READY");
  await expect(
    page.getByText("Cambios sin guardar", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .click();
  await expect(
    page.getByText(
      "Borrador guardado. Puedes continuar editando o revisar el documento.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(stored.status, "DRAFT");
  pass(
    "reopen uses saved snapshots and editing READY requires a fresh DRAFT save and validation",
  );

  await mkdir("test-results", { recursive: true });
  for (const width of [1440, 1280, 820, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Studio overflow at ${width}`,
    );
    const accessibility = await new AxeBuilder({ page })
      .include(".orbit-app")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      accessibility.violations.map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      })),
      [],
      `Studio Axe at ${width}`,
    );
    await page.screenshot({
      path: `test-results/invoice-studio-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Vista previa", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    assert(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
      `Preview overflow at ${width}`,
    );
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Vista previa", exact: true }),
    ).toBeFocused();
  }
  pass(
    "desktop, laptop, tablet and 390/360 mobile have no page/preview overflow; all pass Axe and modal focus return",
  );
  for (const accent of ["PURPLE", "BLUE", "ORANGE", "RED"]) {
    await context.request.post("/api/user/preferences", {
      headers: origin,
      data: { accent },
    });
    await page.goto("/dashboard/invoices/new?draft=studio-draft");
    await expect(page.getByLabel("Descripción · Concepto 1")).toBeVisible();
    const accessibility = await new AxeBuilder({ page })
      .include(".invoice-studio")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      accessibility.violations.map((violation) => violation.id),
      [],
      accent,
    );
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Vista previa", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  pass(
    "all four accents pass Axe; reduced motion retains modal keyboard operation",
  );

  conflict = true;
  await page
    .getByLabel("Descripción · Concepto 1")
    .fill("Mi captura sin sobrescribir");
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .click();
  await expect(
    page.locator(".invoice-studio").getByRole("alert"),
  ).toContainText("Otro cambio actualizó este borrador");
  await expect(page.getByLabel("Descripción · Concepto 1")).toHaveValue(
    "Mi captura sin sobrescribir",
  );
  await expect(
    page.getByRole("button", { name: "Guardar borrador", exact: true }),
  ).toBeDisabled();
  pass("409 preserves unsaved input and blocks silent overwrites");
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/invoice-studio-e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        database: "isolated local PGlite, localhost:3101",
        boundary:
          "Fase 5 responses are browser fixtures; real backend integration remains pending",
        browserErrors: errors.length,
      },
      null,
      2,
    ),
  );
  console.log(
    "Frontend contract fixtures passed; real Fase 5A persistence/fiscal integration is pending.",
  );
} finally {
  await browser?.close();
  if (app.exitCode === null) {
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {}
    } else app.kill("SIGTERM");
  }
  await database.close();
}
