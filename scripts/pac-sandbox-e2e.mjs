import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
import { startDatabase } from "./local-database.mjs";

// Fase 5C.8 E2E (PAC sandbox stamping routes). Ephemeral PGlite only; requires `npm run build`
// and runs the PRODUCTION build (`next start`). No Neon, no production, no real CSD and NO
// PAC: SW_SANDBOX_TOKEN is empty, so the server can never reach SW; the custody harness is
// inert in a production build, so no CSD is VALID. What runs for real: session, plan, same
// origin, rate limit, authorization contract, role, entitlement, tenant isolation, the
// stamping-state contract, the edit lock of an invoice with an active (UNKNOWN) attempt and
// the READY revert that skips it. The full stamping flow (seal → XSD → SW adapter → verified
// stamp) is covered against PGlite in tests/cfdi40-stamp-service.test.ts.
const database = await startDatabase(),
  port = 3199,
  baseURL = `http://localhost:${port}`,
  authSecret = randomBytes(48).toString("hex");
const agentVariable =
  /^(AI_AGENT|CLAUDECODE|CLAUDE_CODE.*|CURSOR_.*|CODEX_.*|GEMINI_CLI|ANTIGRAVITY_AGENT|AUGMENT_AGENT|OPENCODE_CLIENT|REPL_ID|COPILOT_.*)$/i;
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^VERCEL/i.test(key) && !agentVariable.test(key) && !/^SW_/i.test(key),
  ),
);
const guardedFiles = ["AGENTS.md", "CLAUDE.md"];
const guardedBytes = await Promise.all(guardedFiles.map((f) => readFile(f)));
let app = null,
  logs = "";
async function startApp(extra) {
  app = spawn(
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
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...inherited,
        NODE_ENV: "production",
        PRIVACY_NOTICE_VERSION: "",
        DATABASE_URL: database.url,
        BETTER_AUTH_URL: baseURL,
        BETTER_AUTH_SECRET: authSecret,
        MAIL_API_URL: "",
        MAIL_API_TOKEN: "",
        OCR_API_URL: "",
        OCR_API_TOKEN: "",
        ...extra,
      },
    },
  );
  app.stdout.on("data", (b) => (logs += b));
  app.stderr.on("data", (b) => (logs += b));
  const deadline = Date.now() + 45000;
  while (true) {
    try {
      if (
        (await fetch(baseURL + "/login", { signal: AbortSignal.timeout(3000) }))
          .ok
      )
        return;
    } catch {}
    if (Date.now() > deadline)
      throw new Error("Local test server did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
}
async function stopApp() {
  if (!app) return;
  const child = app;
  app = null;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    if (process.platform === "win32")
      await new Promise((resolve) =>
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        }).once("exit", resolve),
      );
    else process.kill(-child.pid, "SIGTERM");
    await exited;
  }
}

const checks = [],
  contexts = [],
  bodies = [],
  origin = { Origin: baseURL };
const pass = (label) => {
  checks.push(label);
  console.log("PASS " + label);
};
const sql = async (query, params = []) =>
  (await database.db.query(query, params)).rows;
async function json(response, status = 200) {
  const text = await response.text();
  bodies.push(text);
  assert.equal(response.status(), status, `Expected ${status}: ${text}`);
  return JSON.parse(text);
}
async function coded(response, status, code) {
  const body = await json(response, status);
  assert.equal(body.code, code, JSON.stringify(body));
  return body;
}
const post = (ctx, path, data, headers = origin) =>
  ctx.post(path, { headers, data });
const patch = (ctx, path, data) => ctx.patch(path, { headers: origin, data });
async function api() {
  const ctx = await request.newContext({ baseURL, timeout: 120000 });
  contexts.push(ctx);
  return ctx;
}
const credential = () =>
  "Synthetic-" + randomBytes(18).toString("hex") + "-9aZ";
async function account(name, organization = true) {
  const ctx = await api();
  const user = (
    await json(
      await post(ctx, "/api/auth/sign-up/email", {
        name,
        email: `${name.toLowerCase()}@example.test`,
        password: credential(),
      }),
    )
  ).user;
  const org = organization
    ? await json(
        await post(ctx, "/api/organizations", { name: "Empresa " + name }),
        201,
      )
    : null;
  return { ctx, user, org };
}
const count = async (table, where = "", params = []) =>
  (await sql(`SELECT COUNT(*)::int AS n FROM "${table}" ${where}`, params))[0]
    .n;
async function insertInvoice(org, userId, clientId) {
  const id = "inv-" + randomBytes(6).toString("hex");
  await sql(
    `INSERT INTO "StampedInvoice" (id,"organizationId","userId",status,version,"clientId","issuerRfc","receiverRfc",subtotal,tax,total,"updatedAt")
     VALUES ($1,$2,$3,'READY',1,$4,'AAA010101AAA','BBB010101BB1',1000,160,1160,NOW())`,
    [id, org, userId, clientId],
  );
  return id;
}
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Mexico_City",
});
const stampPath = (id) => `/api/outgoing-invoices/${id}/stamp`;
const accepted = (version) => ({ accepted: true, version });

try {
  await startApp({
    STAMPING_ENABLED: "true",
    PAC_ENVIRONMENT: "SANDBOX",
    SW_SANDBOX_TOKEN: "",
    CSD_E2E_HARNESS: "",
    CSD_E2E_TEST_AUTHORITIES: "",
  });
  const a = await account("PacOwner");
  const b = await account("PacOther");
  const anon = await api();
  const placeholder = "inv-missing";

  // --- Session and plan ---------------------------------------------------------------
  for (const [method, path] of [
    ["get", stampPath(placeholder)],
    ["post", stampPath(placeholder)],
    ["post", stampPath(placeholder) + "/reconcile"],
  ])
    await json(
      method === "get" ? await anon.get(path) : await post(anon, path, {}),
      401,
    );
  await json(await a.ctx.get(stampPath(placeholder)), 403);
  await sql(
    `INSERT INTO "Subscription" ("organizationId",plan,"updatedAt") VALUES ($1,'PRO',NOW()),($2,'PRO',NOW())`,
    [a.org.id, b.org.id],
  );
  pass("stamping routes require a session and a PRO/MAX plan");

  const clientData = {
    rfc: "BBB010101BB1",
    legalName: "Cliente Timbrado",
    personType: "COMPANY",
    fiscalRegime: "601",
    cfdiUse: "G03",
    email: "client@example.test",
    postalCode: "64000",
    defaultPaymentForm: "03",
    country: "MEX",
  };
  const client = await json(await post(a.ctx, "/api/clients", clientData), 201);
  const ready = await insertInvoice(a.org.id, a.user.id, client.id);
  const stamping = await insertInvoice(a.org.id, a.user.id, client.id);

  // --- State contract -------------------------------------------------------------------
  const stateResponse = await a.ctx.get(stampPath(ready));
  assert.equal(stateResponse.headers()["cache-control"], "private, no-store");
  const state = await json(stateResponse);
  assert.equal(state.availability.enabled, false);
  assert.equal(state.availability.environment, "SANDBOX");
  assert.deepEqual(state.availability.reasons, [
    "PAC_NOT_CONFIGURED",
    "ORGANIZATION_NOT_ENTITLED",
    "CSD_NOT_VALID",
  ]);
  assert.match(state.authorization.version, /^autorizacion-timbrado-/);
  assert.match(state.authorization.text, /Revisé la información del CFDI/);
  assert.deepEqual(
    [
      state.invoice.id,
      state.invoice.status,
      state.invoice.version,
      state.invoice.uuid,
    ],
    [ready, "READY", 1, null],
  );
  assert.equal(state.latestAttempt, null);
  pass(
    "GET stamp state: SANDBOX, terms with version, every missing gate named, no attempt",
  );

  // --- Request contract and gates (nothing is written, nothing leaves) -------------------
  const terms = state.authorization.version;
  await json(
    await post(
      a.ctx,
      stampPath(ready),
      { expectedVersion: 1, authorization: accepted(terms) },
      {
        Origin: "https://foreign.example.test",
      },
    ),
    403,
  );
  await coded(
    await post(a.ctx, stampPath(ready), { expectedVersion: "1" }),
    400,
    "INVALID_REQUEST",
  );
  await coded(
    await post(a.ctx, stampPath(ready), { expectedVersion: 1 }),
    422,
    "STAMPING_NOT_ALLOWED",
  );
  await coded(
    await post(a.ctx, stampPath(ready), {
      expectedVersion: 1,
      authorization: { accepted: true, version: "autorizacion-anterior" },
    }),
    422,
    "STAMPING_NOT_ALLOWED",
  );
  await coded(
    await post(a.ctx, stampPath(ready), {
      expectedVersion: 1,
      authorization: accepted(terms),
    }),
    409,
    "STAMPING_DISABLED",
  );
  await sql(
    `INSERT INTO "StampingEntitlement" ("organizationId",environment,enabled,"updatedAt") VALUES ($1,'SANDBOX',true,NOW())`,
    [a.org.id],
  );
  assert.deepEqual(
    (await json(await a.ctx.get(stampPath(ready)))).availability.reasons,
    ["PAC_NOT_CONFIGURED", "CSD_NOT_VALID"],
  );
  await coded(
    await post(a.ctx, stampPath(ready), {
      expectedVersion: 1,
      authorization: accepted(terms),
    }),
    409,
    "STAMPING_DISABLED",
  );
  assert.equal(await count("StampAttempt"), 0);
  assert.equal(await count("StampAuthorization"), 0);
  pass(
    "authorization is explicit and versioned; without a PAC credential or a VALID CSD nothing is created or sent",
  );

  // --- Roles and tenants -------------------------------------------------------------------
  const m = await account("PacMember", false);
  await sql(
    `INSERT INTO "Membership" (id,"organizationId","userId",role) VALUES ($1,$2,$3,'MEMBER')`,
    ["m-" + m.user.id, a.org.id, m.user.id],
  );
  await json(
    await post(m.ctx, "/api/organizations/active", {
      organizationId: a.org.id,
    }),
  );
  await coded(
    await post(m.ctx, stampPath(ready), {
      expectedVersion: 1,
      authorization: accepted(terms),
    }),
    403,
    "STAMPING_NOT_ALLOWED",
  );
  assert(
    (
      await json(await m.ctx.get(stampPath(ready)))
    ).availability.reasons.includes("ROLE_NOT_ALLOWED"),
  );
  await coded(await b.ctx.get(stampPath(ready)), 404, "INVOICE_NOT_FOUND");
  const foreignStamp = await post(b.ctx, stampPath(ready), {
    expectedVersion: 1,
    authorization: accepted(terms),
  });
  assert([404, 409].includes(foreignStamp.status()));
  const foreignReconcile = await post(
    b.ctx,
    stampPath(ready) + "/reconcile",
    {},
  );
  assert([404, 409].includes(foreignReconcile.status()));
  assert.equal(await count("StampAttempt"), 0);
  pass(
    "a MEMBER cannot stamp; another Organization cannot read, stamp or reconcile the invoice",
  );

  // --- An active (UNKNOWN) attempt locks fiscal edits and survives a READY revert ----------
  const attemptId = randomUUID();
  await sql(
    `INSERT INTO "StampAuthorization" (id,"organizationId","invoiceId","invoiceVersion","userId","termsVersion","termsSha256") VALUES ($1,$2,$3,1,$4,$5,$6)`,
    ["auth-" + attemptId, a.org.id, stamping, a.user.id, terms, "0".repeat(64)],
  );
  await sql(
    `INSERT INTO "StampAttempt" (id,"organizationId","invoiceId","invoiceVersion","authorizationId","requestedById",provider,adapter,environment,"customId","activeKey",status,"resultCode","submittedAt","submissionCount","updatedAt")
     VALUES ($1,$2,$3,1,$4,$5,'SW_SAPIEN','sw-stamp-v4-customid@1','SANDBOX',$6,$7,'UNKNOWN','PAC_SUBMISSION_INTERRUPTED',NOW(),1,NOW())`,
    [
      attemptId,
      a.org.id,
      stamping,
      "auth-" + attemptId,
      a.user.id,
      "orbit-" + attemptId,
      `${a.org.id}:${stamping}`,
    ],
  );
  const unknownText = await (await a.ctx.get(stampPath(stamping))).text();
  bodies.push(unknownText);
  const unknownState = JSON.parse(unknownText);
  assert(unknownState.availability.reasons.includes("RECONCILIATION_REQUIRED"));
  assert.deepEqual(
    [
      unknownState.latestAttempt.id,
      unknownState.latestAttempt.status,
      unknownState.latestAttempt.canReconcile,
      unknownState.latestAttempt.error.code,
    ],
    [attemptId, "UNKNOWN", true, "PAC_SUBMISSION_INTERRUPTED"],
  );
  assert.match(
    unknownState.latestAttempt.error.message,
    /No vuelvas a timbrarlo/,
  );
  for (const hidden of [
    "orbit-" + attemptId,
    "customId",
    "sealedXml",
    "activeKey",
    "requestSha256",
  ])
    assert(!unknownText.includes(hidden), hidden);
  const before = (
    await sql(`SELECT "updatedAt" FROM "StampedInvoice" WHERE id=$1`, [
      stamping,
    ])
  )[0];
  const draft = {
    clientId: client.id,
    invoiceDate: today,
    documentType: "I",
    currency: "MXN",
    cfdiUse: "G03",
    paymentMethod: "PUE",
    paymentForm: "03",
    exportCode: "01",
    concepts: [
      {
        description: "Servicio sintético",
        productCode: "81112200",
        unitCode: "E48",
        quantity: "1",
        unitPrice: "1000.00",
        taxObject: "02",
        vatFactor: "TASA",
        vatRate: "0.16",
      },
    ],
  };
  await coded(
    await patch(a.ctx, "/api/outgoing-invoices/" + stamping, {
      ...draft,
      expectedUpdatedAt: before.updatedAt.toISOString(),
    }),
    409,
    "STAMP_IN_PROGRESS",
  );
  await json(
    await patch(a.ctx, "/api/clients/" + client.id, {
      ...clientData,
      legalName: "Cliente renombrado",
    }),
  );
  const rows = await sql(
    `SELECT id, status::text AS status, version FROM "StampedInvoice" WHERE id = ANY($1) ORDER BY id`,
    [[ready, stamping]],
  );
  assert.deepEqual(
    Object.fromEntries(rows.map((r) => [r.id, [r.status, r.version]])),
    { [ready]: ["DRAFT", 2], [stamping]: ["READY", 1] },
  );
  // Reconciliation needs the PAC: blocked, and the attempt stays exactly as it was.
  await coded(
    await post(a.ctx, stampPath(stamping) + "/reconcile", {}),
    409,
    "STAMPING_DISABLED",
  );
  const after = (
    await sql(
      `SELECT status::text AS status, "submissionCount" FROM "StampAttempt" WHERE id=$1`,
      [attemptId],
    )
  )[0];
  assert.deepEqual([after.status, after.submissionCount], ["UNKNOWN", 1]);
  await coded(
    await post(a.ctx, stampPath(stamping), {
      expectedVersion: 1,
      authorization: accepted(terms),
    }),
    409,
    "STAMPING_DISABLED",
  );
  pass(
    "an UNKNOWN attempt blocks fiscal edits (STAMP_IN_PROGRESS), keeps its invoice READY on a client change and is never retried without the PAC",
  );

  // Nothing secret or internal in any response or in the server log.
  for (const text of [...bodies, logs])
    for (const leak of [
      "SW_SANDBOX_TOKEN",
      "Bearer ",
      "sealedXml",
      "stampedXml",
      "<cfdi:",
    ])
      assert(!text.includes(leak), leak);
  pass("no credential name, Authorization header or XML in responses or logs");
} finally {
  await Promise.all(
    contexts.map((ctx) => ctx.dispose().catch(() => undefined)),
  );
  await stopApp();
  await database.close();
  const after = await Promise.all(guardedFiles.map((f) => readFile(f)));
  guardedFiles.forEach((file, i) =>
    assert(
      after[i].equals(guardedBytes[i]),
      file + " was modified by the test server",
    ),
  );
}
console.log(`\n${checks.length} PAC sandbox E2E checks passed.`);
