import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { syntheticCsf } from "./fixtures/synthetic-csf.mjs";

const postResponse = (page, path) =>
  page.waitForResponse(
    (r) => r.url().endsWith(path) && r.request().method() === "POST",
  );
async function select(page, label, code) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.fill(code);
  await expect(
    page.getByRole("option").filter({ hasText: code }).first(),
  ).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
}
async function upload(page, buffer) {
  const response = postResponse(page, "/api/private-assets");
  await page.locator('form.fiscal-ui input[type="file"]').setInputFiles({
    name: "synthetic-csf.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  const result = await response;
  assert.equal(result.status(), 201);
  return result.json();
}
async function read(page, client = false) {
  const consent = postResponse(page, "/api/fiscal-consents");
  const extraction = postResponse(page, "/api/fiscal-extractions");
  await page
    .getByRole("checkbox", {
      name: client ? /^Declaro que cuento/ : /^Autorizo a ORBIT/,
    })
    .check();
  await page
    .getByRole("button", { name: "Leer y prellenar constancia" })
    .click();
  assert.equal((await consent).status(), 201);
  const response = await extraction;
  assert([200, 201].includes(response.status()));
  const result = await response.json();
  await expect(
    page.getByRole("region", { name: "Revisión de información detectada" }),
  ).toBeVisible();
  return result;
}
export async function fiscalIntegrationChecks({ page, context, pass }) {
  const calls = [];
  const track = (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/fiscal-(consents|extractions)$/.test(r.url())
    )
      calls.push(r.url());
  };
  page.on("request", track);
  await page.goto("/dashboard/fiscal-profile");
  await expect(
    page.getByRole("checkbox", { name: /^Autorizo a ORBIT/ }),
  ).toBeEnabled();
  await expect(
    page.getByText(/Aviso de Privacidad sin versión publicada/),
  ).toBeVisible();
  const buffer = await syntheticCsf({
    rfc: "EKU9003173C9",
    companyName: "EMISOR SINTETICO NUEVO",
    regimes: [
      ["Régimen General de Ley Personas Morales", "17/03/1990"],
      ["Personas Morales con Fines no Lucrativos", "17/03/1990"],
    ],
  });
  const document = await upload(page, buffer);
  assert.equal(
    calls.length,
    0,
    "Selecting a PDF must not create consent or extraction",
  );
  const extraction = await read(page);
  assert.equal(extraction.documentId, document.id);
  assert.equal(extraction.regimes.length, 2);
  assert.equal(extraction.fields.rfc.status, "DETECTED");
  assert.equal(extraction.fields.legalName.status, "LOW_CONFIDENCE");
  assert.equal(extraction.fields.interiorNumber.status, "NOT_FOUND");
  assert(
    extraction.comparison.some((v) => v.field === "legalName" && v.changed),
  );
  assert.equal(calls.length, 2);
  for (const radio of await page.getByRole("radio").all())
    await expect(radio).not.toBeChecked();
  await page.getByRole("button", { name: "Usar en RFC", exact: true }).click();
  await page
    .getByRole("button", { name: "Usar en Nombre / razón social", exact: true })
    .click();
  await page
    .getByLabel("Razón social", { exact: true })
    .fill("Emisor corregido y confirmado");
  await page.getByRole("radio", { name: /601/ }).check();
  await select(page, "Uso CFDI predeterminado", "G03");
  await page
    .getByRole("checkbox", {
      name: "Revisé y confirmo que mis datos fiscales son correctos.",
    })
    .check();
  const saved = postResponse(page, "/api/fiscal-profile");
  await page
    .getByRole("button", { name: "Confirmar y guardar perfil" })
    .click();
  const response = await saved;
  assert.equal(response.status(), 200);
  assert.equal(response.request().postDataJSON().extractionId, extraction.id);
  const profile = await (
    await context.request.get("/api/fiscal-profile")
  ).json();
  assert.equal(profile.sourceExtractionId, extraction.id);
  assert.equal(profile.csfDocumentId, document.id);
  assert.equal(profile.legalName, "Emisor corregido y confirmado");
  await upload(
    page,
    await syntheticCsf({
      rfc: "EKU9003173C9",
      extraRfc: "AAA010101AAA",
      companyName: "EMISOR AMBIGUO SINTETICO",
    }),
  );
  const ambiguous = await read(page);
  assert.equal(ambiguous.fields.rfc.status, "AMBIGUOUS");
  await expect(
    page.locator('.fiscal-detected-field[data-status="AMBIGUOUS"]'),
  ).toBeVisible();
  await expect(page.locator('input[name="rfc"]')).toHaveValue("EKU9003173C9");
  pass(
    "5C real issuer upload -> terms -> consent -> extraction -> GET result -> partial/multiple regimes/comparison -> corrections -> confirmed provenance persisted; no processing before consent",
  );

  await page.goto("/dashboard/fiscal-profile");
  const invalidate = async (route) => {
    const request = route.request();
    await route.continue({
      postData: JSON.stringify({
        ...request.postDataJSON(),
        consentVersion: "outdated-test-version",
      }),
    });
  };
  await page.route("**/api/fiscal-consents", invalidate);
  await page.getByRole("checkbox", { name: /^Autorizo a ORBIT/ }).check();
  const failedConsent = postResponse(page, "/api/fiscal-consents");
  const before = calls.length;
  await page
    .getByRole("button", { name: "Leer y prellenar constancia" })
    .click();
  const failure = await failedConsent;
  assert.equal(failure.status(), 409);
  assert.equal((await failure.json()).code, "CONSENT_VERSION_OUTDATED");
  await expect(page.locator("form.fiscal-ui").getByRole("alert")).toContainText(
    "La autorización cambió",
  );
  assert.equal(
    calls.length,
    before + 1,
    "Consent failure must not invoke extraction",
  );
  await expect(
    page.locator(".fiscal-csf").getByRole("checkbox"),
  ).not.toBeChecked();
  await page.unroute("**/api/fiscal-consents", invalidate);
  await page.getByRole("button", { name: "Actualizar autorización" }).click();
  await expect(
    page.getByRole("checkbox", { name: /^Autorizo a ORBIT/ }),
  ).toBeEnabled();
  const breakCatalog = (route) =>
    route.fulfill({
      status: 503,
      json: { error: "internal stack must not appear" },
    });
  await page.route("**/api/fiscal-catalogs/fiscal-regimes?*", breakCatalog);
  await page
    .getByRole("combobox", { name: "Régimen fiscal", exact: true })
    .fill("601");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "No pudimos cargar el catálogo" }),
  ).toBeVisible();
  await expect(page.locator(".fiscal-ui")).not.toContainText("internal stack");
  await page.keyboard.press("Escape");
  await page.unroute("**/api/fiscal-catalogs/fiscal-regimes?*", breakCatalog);
  pass(
    "5C backend CONSENT_VERSION_OUTDATED/409 safely displayed; acceptance reset, no extraction, terms reload; catalog failure has no fixture fallback",
  );

  await page.goto("/dashboard/clients");
  const row = page
    .getByRole("row")
    .filter({ hasText: "Cliente manual Fase 5C revisado" });
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  const clientDoc = await upload(
    page,
    await syntheticCsf({
      rfc: "EKU9003173C9",
      companyName: "CLIENTE SINTETICO DETECTADO",
    }),
  );
  const clientExtraction = await read(page, true);
  assert(clientExtraction.clientId);
  assert.equal(clientExtraction.documentId, clientDoc.id);
  assert(
    clientExtraction.comparison.some(
      (v) => v.field === "legalName" && v.changed,
    ),
  );
  await page
    .getByRole("button", { name: "Usar en Nombre / razón social", exact: true })
    .click();
  await page.locator('input[name="legalName"]').fill("Cliente CSF corregido");
  await page.getByRole("radio", { name: /601/ }).check();
  await page
    .getByRole("checkbox", {
      name: "Revisé y confirmo que los datos fiscales del cliente son correctos.",
    })
    .check();
  const patched = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" && r.url().includes("/api/clients/"),
  );
  await page
    .getByRole("button", { name: "Guardar cliente", exact: true })
    .click();
  assert.equal((await patched).status(), 200);
  const clients = await (await context.request.get("/api/clients")).json();
  const persisted = clients.find((c) => c.id === clientExtraction.clientId);
  assert.equal(persisted.sourceExtractionId, clientExtraction.id);
  assert.equal(persisted.csfDocumentId, clientDoc.id);
  assert.equal(persisted.legalName, "Cliente CSF corregido");
  pass(
    "5C existing client CLIENT_CSF upload, real consent/extraction/comparison, correction and PATCH persist matching extractionId and CSF",
  );

  await page
    .getByRole("row")
    .filter({ hasText: "Cliente CSF corregido" })
    .getByRole("button", { name: "Editar", exact: true })
    .click();
  const origin = { Origin: new URL(page.url()).origin };
  const invalid = await context.request.patch(`/api/clients/${persisted.id}`, {
    headers: origin,
    data: {
      ...persisted,
      fiscalRegime: "605",
      cfdiUse: "G03",
      personType: "COMPANY",
    },
  });
  assert.equal(invalid.status(), 400);
  assert((await invalid.json()).fields.fiscalRegime.length);
  const invalidPayload = async (route) =>
    route.continue({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        fiscalRegime: "605",
      }),
    });
  await page.route(`**/api/clients/${persisted.id}`, invalidPayload);
  await page
    .getByRole("checkbox", {
      name: "Revisé y confirmo que los datos fiscales del cliente son correctos.",
    })
    .check();
  const uiRejected = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      r.url().endsWith(`/api/clients/${persisted.id}`),
  );
  await page
    .getByRole("button", { name: "Guardar cliente", exact: true })
    .click();
  assert.equal((await uiRejected).status(), 400);
  await expect(page.locator("form.fiscal-ui").getByRole("alert")).toContainText(
    "régimen fiscal",
  );
  await expect(page.locator('input[name="fiscalRegime"]')).toHaveValue("601");
  await page.unroute(`**/api/clients/${persisted.id}`, invalidPayload);
  const archived = await context.request.delete(
    `/api/clients/${persisted.id}`,
    { headers: origin },
  );
  assert.equal(archived.status(), 200);
  await page.getByRole("checkbox", { name: /^Declaro que cuento/ }).check();
  const rejected = postResponse(page, "/api/fiscal-consents");
  await page
    .getByRole("button", { name: "Leer y prellenar constancia" })
    .click();
  assert.equal((await rejected).status(), 404);
  await expect(page.locator(".fiscal-csf").getByRole("alert")).toContainText(
    "archivado",
  );
  await expect(
    page.getByRole("button", { name: "Leer y prellenar constancia" }),
  ).toBeDisabled();
  pass(
    "5C invalid regime/person combination rejected by real backend; archived client consent rejected and further processing blocked",
  );
  page.off("request", track);
}
