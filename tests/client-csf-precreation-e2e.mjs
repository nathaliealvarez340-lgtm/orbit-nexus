import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { PDFDocument, PDFHexString } from "pdf-lib";
import sharp from "sharp";
import { startDatabase } from "../scripts/local-database.mjs";
import { syntheticCsf } from "./fixtures/synthetic-csf.mjs";

// Client CSF read before the client exists (docs/tasks/CLIENT-CSF-PRECREATION.md), end to
// end through the real APIs: local build (`npm run build` first), ephemeral PGlite,
// synthetic data only. The same database is then served as a production deployment to
// show what the Privacy Notice gate still blocks. No CSD is configured at any point.
const database = await startDatabase();
const secret = randomBytes(48).toString("hex");
const checks = [];
const pass = (message) => {
  checks.push(message);
  console.log("PASS " + message);
};
const sql = async (text, values = []) =>
  (await database.db.query(text, values)).rows;
const count = async (table, where = "TRUE", values = []) =>
  (
    await sql(
      `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${where}`,
      values,
    )
  )[0].n;

let server, browser;
async function startServer(port, env = {}) {
  const baseURL = "http://localhost:" + port;
  let logs = "";
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
        VERCEL_ENV: "",
        PAC_ENVIRONMENT: "SANDBOX",
        PRIVACY_NOTICE_VERSION: "",
        DATABASE_URL: database.url,
        BETTER_AUTH_URL: baseURL,
        BETTER_AUTH_SECRET: secret,
        MAIL_API_URL: "",
        MAIL_API_TOKEN: "",
        OCR_API_URL: "",
        OCR_API_TOKEN: "",
        ...env,
      },
    },
  );
  app.stdout.on("data", (chunk) => (logs += chunk));
  app.stderr.on("data", (chunk) => (logs += chunk));
  for (let i = 0; i < 120 && !logs.includes("Ready in"); i++) {
    if (app.exitCode !== null) throw new Error("Local server failed to start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(logs.includes("Ready in"));
  return {
    baseURL,
    logs: () => logs,
    async stop() {
      if (app.exitCode !== null) return;
      if (process.platform === "win32")
        execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      else app.kill();
      if (app.exitCode === null)
        await new Promise((resolve) => app.once("exit", resolve));
    },
  };
}

async function tenant(label, baseURL, organization = true) {
  const context = await browser.newContext({ baseURL });
  const call = async (method, path, data, status) => {
    const response = await context.request.fetch(path, {
      method,
      headers: { Origin: server.baseURL },
      ...(data?.multipart
        ? { multipart: data.multipart }
        : data !== undefined
          ? { data }
          : {}),
    });
    if (status !== undefined)
      assert.equal(
        response.status(),
        status,
        `${method} ${path}: ${await response.text()}`,
      );
    return response;
  };
  const json = async (method, path, data, status = 200) =>
    (await call(method, path, data, status)).json();
  const email = label.toLowerCase().replace(/\W+/g, "-") + "@example.test";
  await json("POST", "/api/auth/sign-up/email", {
    name: label,
    email,
    password: randomBytes(24).toString("base64url") + "-9aZ",
  });
  const [{ id: userId }] = await sql('SELECT id FROM "User" WHERE email=$1', [
    email,
  ]);
  let org = null;
  if (organization) {
    org = await json(
      "POST",
      "/api/organizations",
      { name: label + " org" },
      201,
    );
    await sql(
      'INSERT INTO "Subscription" ("organizationId",plan,"updatedAt") VALUES ($1,$2,NOW())',
      [org.id, "PRO"],
    );
  }
  const upload = (
    buffer,
    {
      kind = "CLIENT_CSF",
      name = "constancia.pdf",
      mimeType = "application/pdf",
    } = {},
    status,
  ) =>
    call(
      "POST",
      "/api/private-assets",
      {
        multipart: { kind, file: { name, mimeType, buffer } },
      },
      status,
    );
  return { context, call, json, upload, userId, org };
}
const codeOf = async (response) => (await response.json()).code;

await mkdir("test-results", { recursive: true });
try {
  server = await startServer(3125);
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === "win32" ? "msedge" : undefined,
  });
  const a = await tenant("Precreation QA A", server.baseURL);
  const b = await tenant("Precreation QA B", server.baseURL);
  // C belongs to A's Organization but did not upload anything.
  const c = await tenant("Precreation QA C", server.baseURL, false);
  await sql(
    'INSERT INTO "Membership" (id,"organizationId","userId",role) VALUES ($1,$2,$3,\'MEMBER\')',
    ["precreation-member-c", a.org.id, c.userId],
  );

  // --- 1. Select and store the CSF before any client exists ------------------------------
  const csf = await syntheticCsf({
    rfc: "EKU9003173C9",
    companyName: "CLIENTE PRECREACION QA",
    postalCode: "42501",
  });
  const uploaded = await (await a.upload(csf, undefined, 201)).json();
  assert.deepEqual(Object.keys(uploaded).sort(), [
    "expiresAt",
    "fileName",
    "id",
    "precreationCsfReference",
  ]);
  const reference = uploaded.precreationCsfReference;
  assert.match(reference, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert(!reference.includes(a.org.id) && !reference.includes(a.userId));
  const ttl = new Date(uploaded.expiresAt).getTime() - Date.now();
  assert(ttl > 23.9 * 3600_000 && ttl <= 24 * 3600_000, String(ttl));
  assert.deepEqual(
    await sql(
      'SELECT kind, "organizationId", "uploadedById", "mimeType" FROM "Document" WHERE id=$1',
      [uploaded.id],
    ),
    [
      {
        kind: "CLIENT_CSF",
        organizationId: a.org.id,
        uploadedById: a.userId,
        mimeType: "application/pdf",
      },
    ],
  );
  assert.equal(await count("Client"), 0);
  // Pending: only its uploader can read the file; the reference is no file URL.
  const download = await a.call(
    "GET",
    "/api/documents/" + uploaded.id,
    undefined,
    200,
  );
  assert.match(download.headers()["content-disposition"], /^attachment/);
  await c.call("GET", "/api/documents/" + uploaded.id, undefined, 404);
  await b.call("GET", "/api/documents/" + uploaded.id, undefined, 404);
  await a.call(
    "GET",
    "/api/documents/" + encodeURIComponent(reference),
    undefined,
    404,
  );
  // Invalid files are refused before storing anything and get no reference.
  const documents = await count("Document");
  const encrypted = await PDFDocument.create();
  encrypted.addPage().drawText("SYNTHETIC ENCRYPTED PDF");
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(
    encrypted.context.obj({
      Filter: "Standard",
      V: 1,
      R: 2,
      Length: 40,
      P: -44,
      O: PDFHexString.of("00".repeat(32)),
      U: PDFHexString.of("00".repeat(32)),
    }),
  );
  const png = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  for (const [label, buffer, status] of [
    ["not a PDF", png, [400]],
    ["broken PDF", Buffer.from("%PDF-1.7 roto"), [400]],
    [
      "encrypted PDF",
      Buffer.from(await encrypted.save({ useObjectStreams: false })),
      [400],
    ],
    [
      "over 10 MB",
      Buffer.concat([csf, Buffer.alloc(10 * 1024 * 1024)]),
      [400, 413],
    ],
  ]) {
    const response = await a.upload(buffer);
    assert(status.includes(response.status()), label + " " + response.status());
    assert(
      !("precreationCsfReference" in ((await response.json()) ?? {})),
      label,
    );
  }
  assert.equal(await count("Document"), documents);
  pass(
    "a CSF is selected and stored privately before any client exists, with an opaque reference that is no file URL; invalid, encrypted and oversized PDFs are refused",
  );

  // --- 2. Authorize and read it without a client --------------------------------------------
  // The issuer's own profile must never be used as the comparison of a new client.
  const issuerCsf = await (
    await a.upload(
      await syntheticCsf({ rfc: "AAA010101AAA", companyName: "EMISOR QA" }),
      { kind: "CSF" },
      201,
    )
  ).json();
  await a.json("POST", "/api/fiscal-profile", {
    rfc: "AAA010101AAA",
    legalName: "EMISOR QA",
    fiscalRegime: "601",
    personType: "COMPANY",
    cfdiUse: "G03",
    postalCode: "06600",
    email: "emisor@example.test",
    country: "MEX",
    confirmed: true,
    csfDocumentId: issuerCsf.id,
  });
  const terms = await a.json(
    "GET",
    "/api/fiscal-consents/terms?purpose=CLIENT_FISCAL_PREFILL",
  );
  const consentRequest = {
    documentId: uploaded.id,
    purpose: "CLIENT_FISCAL_PREFILL",
    accepted: true,
    consentVersion: terms.consentVersion,
    privacyNoticeVersion: terms.privacyNoticeVersion,
  };
  assert.equal(
    await codeOf(
      await a.call("POST", "/api/fiscal-consents", consentRequest, 400),
    ),
    "CLIENT_REQUIRED",
  );
  assert.equal(
    await codeOf(
      await a.call(
        "POST",
        "/api/fiscal-consents",
        { ...consentRequest, newClient: true, clientId: "cualquiera" },
        400,
      ),
    ),
    "CLIENT_NOT_ALLOWED",
  );
  assert.equal(
    await codeOf(
      await c.call(
        "POST",
        "/api/fiscal-consents",
        { ...consentRequest, newClient: true },
        404,
      ),
    ),
    "PRECREATION_CSF_NOT_AVAILABLE",
  );
  assert.equal(
    await codeOf(
      await b.call(
        "POST",
        "/api/fiscal-consents",
        { ...consentRequest, newClient: true },
        404,
      ),
    ),
    "DOCUMENT_NOT_AVAILABLE",
  );
  const consent = await a.json(
    "POST",
    "/api/fiscal-consents",
    { ...consentRequest, newClient: true },
    201,
  );
  assert.equal(consent.clientId, null);
  const extraction = await a.json(
    "POST",
    "/api/fiscal-extractions",
    { consentId: consent.id },
    201,
  );
  assert.deepEqual(
    [extraction.clientId, extraction.documentId, extraction.purpose],
    [null, uploaded.id, "CLIENT_FISCAL_PREFILL"],
  );
  assert(["PROCESSED", "PARTIAL"].includes(extraction.status));
  assert.equal(extraction.fields.rfc.value, "EKU9003173C9");
  assert.equal(extraction.fields.legalName.value, "CLIENTE PRECREACION QA");
  assert.equal(extraction.fields.postalCode.value, "42501");
  assert(extraction.regimes.some((regime) => regime.code === "601"));
  // Never inferred from a CSF (§8.3).
  for (const key of ["cfdiUse", "email", "phone"])
    assert.equal(key in extraction.fields, false, key);
  assert.deepEqual(extraction.comparison, []);
  assert.equal(extraction.precreationCsfReference, reference);
  const read = await a.json("GET", "/api/fiscal-extractions/" + extraction.id);
  assert.equal(read.id, extraction.id);
  await c.call(
    "GET",
    "/api/fiscal-extractions/" + extraction.id,
    undefined,
    404,
  );
  await b.call(
    "GET",
    "/api/fiscal-extractions/" + extraction.id,
    undefined,
    404,
  );
  pass(
    "the CSF is authorized and read without a client: real RFC, name, postal code and regimes return, nothing is inferred and nothing is compared with the issuer; other users and tenants cannot read it",
  );

  // --- 3. Create the client: one link, the user's corrections win ---------------------------
  const clientData = {
    rfc: "EKU9003173C9",
    legalName: "Cliente Corregido QA",
    personType: "COMPANY",
    fiscalRegime: "601",
    cfdiUse: "G03",
    email: "cliente-precreacion@example.test",
    postalCode: "42501",
    confirmed: true,
    extractionId: extraction.id,
    precreationCsfReference: reference,
  };
  // A rejected creation keeps the CSF usable and creates nothing.
  await a.call(
    "POST",
    "/api/clients",
    { ...clientData, fiscalRegime: "605" },
    400,
  );
  await a.call(
    "POST",
    "/api/clients",
    { ...clientData, confirmed: undefined },
    400,
  );
  assert.equal(await count("Client"), 0);
  for (const [actor, value] of [
    [c, reference],
    [b, reference],
    [a, reference.slice(0, -2) + (reference.endsWith("AA") ? "BB" : "AA")],
  ])
    assert.equal(
      await codeOf(
        await actor.call(
          "POST",
          "/api/clients",
          { ...clientData, precreationCsfReference: value },
          404,
        ),
      ),
      "PRECREATION_CSF_NOT_AVAILABLE",
    );
  assert.equal(await count("Client"), 0);
  // Two simultaneous creations with the same reference: exactly one client.
  const race = await Promise.all([
    a.call("POST", "/api/clients", clientData),
    a.call("POST", "/api/clients", clientData),
  ]);
  assert.deepEqual(
    race.map((response) => response.status()).sort(),
    [201, 409],
  );
  const winner = race.find((response) => response.status() === 201);
  const loser = race.find((response) => response.status() === 409);
  assert.equal(await codeOf(loser), "PRECREATION_CSF_CONSUMED");
  const created = await winner.json();
  assert.equal(created.organizationId, a.org.id);
  assert.equal(created.legalName, "Cliente Corregido QA");
  assert.deepEqual(
    await sql(
      'SELECT "organizationId", "csfDocumentId", "sourceExtractionId", "confirmedAt" IS NOT NULL AS confirmed FROM "Client" WHERE id=$1',
      [created.id],
    ),
    [
      {
        organizationId: a.org.id,
        csfDocumentId: uploaded.id,
        sourceExtractionId: extraction.id,
        confirmed: true,
      },
    ],
  );
  const [stored] = await sql(
    'SELECT "clientId", fields FROM "FiscalDocumentExtraction" WHERE id=$1',
    [extraction.id],
  );
  assert.equal(stored.clientId, created.id);
  // The detected data stays as read; the corrected value lives only in the client.
  assert.equal(stored.fields.legalName.value, "CLIENTE PRECREACION QA");
  assert.equal(await count("Document"), documents + 1);
  assert.equal(
    await codeOf(await a.call("POST", "/api/clients", clientData, 409)),
    "PRECREATION_CSF_CONSUMED",
  );
  assert.equal(
    await codeOf(
      await a.call(
        "PATCH",
        "/api/clients/" + created.id,
        { ...clientData, extractionId: undefined },
        400,
      ),
    ),
    "PRECREATION_CSF_NOT_ALLOWED",
  );
  assert.equal(await count("Client"), 1);
  assert.deepEqual(
    (await a.json("GET", "/api/clients")).map((item) => item.id),
    [created.id],
  );
  assert(
    (await a.json("GET", "/api/outgoing-invoices/context")).clients.some(
      (item) => item.id === created.id,
    ),
  );
  assert.deepEqual(await b.json("GET", "/api/clients"), []);
  // Linked, it is an ordinary client document of the Organization.
  await c.call("GET", "/api/documents/" + uploaded.id, undefined, 200);
  pass(
    "creating the client links that same CSF and its reading once, in the right Organization; corrections are saved, the reading stays raw, failures create nothing, and a reused, foreign or forged reference is refused",
  );

  // --- 4. Unreadable, expired and abandoned CSF ---------------------------------------------
  const blank = await (
    await a.upload(await syntheticCsf({ blank: true }), undefined, 201)
  ).json();
  const blankConsent = await a.json(
    "POST",
    "/api/fiscal-consents",
    { ...consentRequest, documentId: blank.id, newClient: true },
    201,
  );
  const unreadable = await a.json(
    "POST",
    "/api/fiscal-extractions",
    { consentId: blankConsent.id },
    201,
  );
  assert.equal(unreadable.status, "UNREADABLE");
  assert(
    Object.values(unreadable.fields).every((field) => field.value === null),
  );
  assert.deepEqual(unreadable.regimes, []);
  assert(unreadable.message);
  // Expired: unusable for reading, linking and downloading.
  const late = await (await a.upload(csf, undefined, 201)).json();
  const abandoned = blank;
  await sql(
    `UPDATE "Document" SET "createdAt" = NOW() - INTERVAL '25 hours' WHERE id = ANY($1)`,
    [[late.id, abandoned.id, uploaded.id]],
  );
  assert.equal(
    await codeOf(
      await a.call(
        "POST",
        "/api/fiscal-consents",
        { ...consentRequest, documentId: late.id, newClient: true },
        410,
      ),
    ),
    "PRECREATION_CSF_EXPIRED",
  );
  assert.equal(
    await codeOf(
      await a.call(
        "POST",
        "/api/clients",
        {
          ...clientData,
          rfc: "EKU9003173C9",
          extractionId: undefined,
          precreationCsfReference: late.precreationCsfReference,
        },
        410,
      ),
    ),
    "PRECREATION_CSF_EXPIRED",
  );
  await a.call("GET", "/api/documents/" + late.id, undefined, 404);
  await a.call(
    "POST",
    "/api/fiscal-extractions",
    { consentId: blankConsent.id },
    410,
  );
  assert.equal(await count("Client"), 1);
  // Any later client CSF upload, even of another Organization, deletes abandoned ones.
  await b.upload(csf, undefined, 201);
  assert.equal(
    await count("Document", "id = ANY($1)", [[late.id, abandoned.id]]),
    0,
  );
  assert.equal(
    await count("FiscalDocumentConsent", '"documentId" = $1', [abandoned.id]),
    0,
  );
  assert.equal(
    await count("FiscalDocumentExtraction", '"documentId" = $1', [
      abandoned.id,
    ]),
    0,
  );
  assert.equal(
    await count("Document", "id = $1", [uploaded.id]),
    1,
    "linked CSF stays",
  );
  assert.deepEqual(
    (
      await sql(
        `SELECT "organizationId", "actorUserId", metadata FROM "AuditEvent" WHERE action = 'sensitive_asset.deleted' AND "targetId" = ANY($1) ORDER BY "targetId"`,
        [[late.id, abandoned.id].sort()],
      )
    ).map((row) => [row.organizationId, row.actorUserId, row.metadata]),
    [late.id, abandoned.id].map(() => [
      a.org.id,
      null,
      { kind: "CLIENT_CSF", reason: "PRECREATION_EXPIRED" },
    ]),
  );
  pass(
    "an unreadable CSF invents nothing; an expired one cannot be read, linked or downloaded; abandoned ones are deleted with their consents and readings and audited without contents, while linked ones stay",
  );

  // --- 5. No CSD ------------------------------------------------------------------------------
  assert.equal((await a.json("GET", "/api/csd")).status, "NOT_CONFIGURED");
  assert.equal(await count("CsdCertificate"), 0);
  pass("uploading, reading and creating the client from a CSF needed no CSD");

  // --- 6. Production: store and link allowed, reading blocked by the Privacy Notice ----------
  const pendingConsent = await a.json(
    "POST",
    "/api/fiscal-consents",
    {
      ...consentRequest,
      documentId: (await (await a.upload(csf, undefined, 201)).json()).id,
      newClient: true,
    },
    201,
  );
  for (const context of [b.context, c.context]) await context.close();
  await server.stop();
  server = await startServer(3126, { VERCEL_ENV: "production" });
  const p = await tenant("Precreation QA production", server.baseURL);
  const productionUpload = await (await p.upload(csf, undefined, 201)).json();
  assert(productionUpload.precreationCsfReference);
  const productionTerms = await p.json(
    "GET",
    "/api/fiscal-consents/terms?purpose=CLIENT_FISCAL_PREFILL",
  );
  assert.equal(productionTerms.privacyNoticeVersion, null);
  assert.equal(
    await codeOf(
      await p.call(
        "POST",
        "/api/fiscal-consents",
        {
          documentId: productionUpload.id,
          purpose: "CLIENT_FISCAL_PREFILL",
          newClient: true,
          accepted: true,
          consentVersion: productionTerms.consentVersion,
          privacyNoticeVersion: null,
        },
        503,
      ),
    ),
    "PRIVACY_NOTICE_MISSING",
  );
  // Reading a document authorized before is blocked too (A's session, same database).
  const blocked = await a.context.request.post(
    server.baseURL + "/api/fiscal-extractions",
    {
      headers: { Origin: server.baseURL },
      data: { consentId: pendingConsent.id },
    },
  );
  assert.equal(blocked.status(), 503);
  assert.equal((await blocked.json()).code, "PRIVACY_NOTICE_MISSING");
  assert.equal(
    await count("FiscalDocumentExtraction", '"consentId" = $1', [
      pendingConsent.id,
    ]),
    0,
  );
  const productionClient = await p.json(
    "POST",
    "/api/clients",
    {
      ...clientData,
      legalName: "Cliente Capturado En Produccion",
      extractionId: undefined,
      precreationCsfReference: productionUpload.precreationCsfReference,
    },
    201,
  );
  assert.deepEqual(
    await sql(
      'SELECT "csfDocumentId", "sourceExtractionId" FROM "Client" WHERE id=$1',
      [productionClient.id],
    ),
    [{ csfDocumentId: productionUpload.id, sourceExtractionId: null }],
  );
  assert.equal(
    await count("FiscalDocumentExtraction", '"documentId" = $1', [
      productionUpload.id,
    ]),
    0,
  );
  pass(
    "in production the CSF can be selected, stored and linked to the new client, while authorizing and reading it stays blocked with PRIVACY_NOTICE_MISSING",
  );

  await writeFile(
    "test-results/client-csf-precreation-e2e-summary.json",
    JSON.stringify({ passed: true, checks }, null, 2),
  );
} catch (error) {
  await writeFile(
    "test-results/client-csf-precreation-e2e-summary.json",
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  if (server)
    await writeFile(
      "test-results/client-csf-precreation-server.log",
      server.logs(),
    );
  throw error;
} finally {
  await browser?.close();
  await server?.stop();
  await database.close();
}
