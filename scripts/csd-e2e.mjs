import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
import { startDatabase } from "./local-database.mjs";
import {
  syntheticAuthority,
  syntheticCsd,
  syntheticPassword,
} from "../tests/fixtures/synthetic-csd.mjs";

// Fase 5C.3 Bloque 1A E2E (CSD custody backend). Ephemeral PGlite only; requires
// `npm run build`. No Neon, no production, no PAC, no real CSD. Certificates are SYNTHETIC,
// signed by a synthetic CA, and DO NOT prove SAT validity.
//
// The synthetic CA reaches the server only through the local test harness
// (src/lib/csd/test-authorities.ts), which requires a non-production runtime. So:
// - phase 1 runs `next dev` (NODE_ENV=development, writes to .next/dev) with ALL harness
//   conditions to exercise real multipart configuration end to end;
// - phase 2 runs the PRODUCTION build (`next start`) with the very same variables and
//   proves the harness is inert there, then checks the other fail-closed configurations.
const database = await startDatabase(),
  port = 3197,
  baseURL = `http://localhost:${port}`,
  authSecret = randomBytes(48).toString("hex"),
  authority = syntheticAuthority(),
  injected = Buffer.from(authority.certificate).toString("base64"),
  kekV1 = randomBytes(32).toString("base64");
const rfcA = "SCA010101AB1",
  rfcB = "SCB020202CD2";
const sandbox = {
  PAC_ENVIRONMENT: "SANDBOX",
  CSD_KEY_PROVIDER_SANDBOX: "env",
  CSD_KEY_PROVIDER_PRODUCTION: "",
  CSD_KEK_ID: "orbit-csd-e2e",
  CSD_KEK_CURRENT_VERSION: "1",
  CSD_KEK_V1: kekV1,
  CSD_REAUTH_WINDOW_SECONDS: "",
  // Local harness: explicit flag + synthetic CA; also needs loopback PGlite, no Vercel
  // variable and a non-production runtime.
  CSD_E2E_HARNESS: "local-ephemeral-only",
  CSD_E2E_TEST_AUTHORITIES: injected,
};
// Never inherit a Vercel variable from the operator's shell, nor the variables `next dev`
// uses to detect a coding agent: when it detects one it rewrites AGENTS.md/CLAUDE.md
// (node_modules/next/dist/server/lib/app-info-log.js), and this test must not touch them.
const agentVariable =
  /^(AI_AGENT|CLAUDECODE|CLAUDE_CODE.*|CURSOR_.*|CODEX_.*|GEMINI_CLI|ANTIGRAVITY_AGENT|AUGMENT_AGENT|OPENCODE_CLIENT|REPL_ID|COPILOT_.*)$/i;
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^VERCEL/i.test(key) && !agentVariable.test(key),
  ),
);
const guardedFiles = ["AGENTS.md", "CLAUDE.md"];
const guardedBytes = await Promise.all(
  guardedFiles.map((file) => readFile(file)),
);
let app = null,
  logs = "";
async function startApp(mode, extra) {
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      mode,
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      windowsHide: true,
      // POSIX: own process group so the whole dev server tree can be stopped.
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...inherited,
        NODE_ENV: mode === "dev" ? "development" : "production",
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
  const deadline = Date.now() + (mode === "dev" ? 180000 : 45000);
  while (true) {
    try {
      if (
        (
          await fetch(baseURL + "/login", {
            signal: AbortSignal.timeout(mode === "dev" ? 120000 : 3000),
          })
        ).ok
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
    // `next dev` runs a child server: stop the whole tree.
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
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      await fetch(baseURL + "/login", { signal: AbortSignal.timeout(1000) });
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Local test server did not stop");
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
const post = (ctx, path, data) => ctx.post(path, { headers: origin, data });
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
async function join(member, org, role) {
  await sql(
    `INSERT INTO "Membership" (id,"organizationId","userId",role) VALUES ($1,$2,$3,$4)`,
    ["m-" + member.user.id, org.id, member.user.id, role],
  );
  await json(
    await post(member.ctx, "/api/organizations/active", {
      organizationId: org.id,
    }),
  );
}
async function confirmProfile(org, owner, rfc) {
  await sql(
    `INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,"confirmedAt","updatedAt")
     VALUES ($1,$2,$3,$4,'EMPRESA SINTETICA','601','42501','G03','fiscal@example.test',NOW(),NOW())`,
    ["fp-" + org.id, owner.user.id, org.id, rfc],
  );
}
const materials = [];
function material(rfc, issuer = authority, options = {}) {
  const value = syntheticCsd(issuer, { rfc, ...options });
  materials.push(value);
  return value;
}
const configure = (ctx, value, extra = {}, headers = origin) =>
  ctx.post("/api/csd", {
    headers,
    multipart: {
      certificate: {
        name: "certificado.cer",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(value.certificate),
      },
      privateKey: {
        name: "llave.key",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(value.privateKey),
      },
      password: value.password,
      custodyTermsVersion: terms.version,
      accepted: "true",
      ...extra,
    },
  });
const disable = (ctx, expectedActiveCsdId, headers = origin) =>
  ctx.post("/api/csd/disable", {
    headers,
    data: { expectedActiveCsdId, confirm: true },
  });
// Prisma stores timestamp(3) as UTC wall-clock time; PGlite NOW() follows the host time zone.
const utcNow = "(NOW() AT TIME ZONE 'UTC')";
const resetRateLimits = () => sql(`DELETE FROM "RequestLimit"`);
const audit = (action, organizationId) =>
  sql(
    `SELECT result,metadata,"actorUserId" FROM "AuditEvent" WHERE action=$1 AND "organizationId"=$2 ORDER BY "createdAt"`,
    [action, organizationId],
  );
let terms = { version: "" };

await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/csd-e2e-summary.json",
  JSON.stringify({ passed: false }),
);
try {
  await startApp("dev", sandbox);
  const a = await account("CsdOwnerA"),
    admin = await account("CsdAdminA", false),
    m = await account("CsdMemberA", false),
    b = await account("CsdOwnerB"),
    anon = await api();
  await join(admin, a.org, "ADMIN");
  await join(m, a.org, "MEMBER");
  await confirmProfile(a.org, a, rfcA);
  await confirmProfile(b.org, b, rfcB);

  // --- Authentication, roles and origin -----------------------------------------------
  for (const path of ["/api/csd", "/api/csd/history", "/api/csd/custody-terms"])
    await json(await anon.get(path), 401);
  for (const path of ["/api/csd", "/api/csd/history", "/api/csd/custody-terms"])
    await coded(await m.ctx.get(path), 403, "CSD_FORBIDDEN");
  await coded(await configure(m.ctx, material(rfcA)), 403, "CSD_FORBIDDEN");
  await coded(await disable(m.ctx, "x"), 403, "CSD_FORBIDDEN");
  assert.deepEqual(
    (await audit("csd.configuration.started", a.org.id)).map((e) => [
      e.result,
      e.metadata,
    ]),
    [["DENIED", { reason: "ROLE" }]],
  );
  assert.deepEqual(
    (await audit("csd.disabled", a.org.id)).map((e) => [e.result, e.metadata]),
    [["DENIED", { reason: "ROLE" }]],
  );
  pass("anonymous 401; MEMBER gets 403 CSD_FORBIDDEN and DENIED audit");

  terms = await json(await a.ctx.get("/api/csd/custody-terms"));
  assert.match(terms.version, /borrador/);
  assert.match(terms.text, /sujeta a revisión jurídica/);
  const initial = await json(await a.ctx.get("/api/csd"));
  assert.deepEqual(
    [initial.status, initial.serviceAvailable, initial.canManage, initial.id],
    ["NOT_CONFIGURED", true, true, null],
  );
  await json(await configure(a.ctx, material(rfcA), {}, {}), 403);
  await json(
    await configure(
      a.ctx,
      material(rfcA),
      {},
      { Origin: "https://evil.example" },
    ),
    403,
  );
  await json(await disable(a.ctx, "x", {}), 403);
  pass(
    "OWNER reads state and custody terms; mutations require the same origin",
  );

  // --- Recent sign-in (§D.1) --------------------------------------------------------
  // A renewed but old session (createdAt 20 min ago, updatedAt/expiresAt fresh) is not recent.
  await sql(
    `UPDATE "Session" SET "createdAt"=${utcNow} - INTERVAL '20 minutes', "updatedAt"=${utcNow}, "expiresAt"=${utcNow} + INTERVAL '7 days' WHERE "userId"=$1`,
    [a.user.id],
  );
  const stale = material(rfcA);
  await coded(await configure(a.ctx, stale), 401, "CSD_REAUTH_REQUIRED");
  await coded(await disable(a.ctx, "x"), 401, "CSD_REAUTH_REQUIRED");
  await json(await a.ctx.get("/api/csd"));
  assert.deepEqual(
    (await audit("csd.configuration.started", a.org.id))
      .slice(-1)
      .map((e) => [e.result, e.metadata]),
    [["DENIED", { reason: "REAUTH_REQUIRED" }]],
  );
  assert.equal(
    (await sql(`SELECT 1 FROM "CsdCertificate"`)).length,
    0,
    "nothing stored",
  );
  await sql(`UPDATE "Session" SET "createdAt"=${utcNow} WHERE "userId"=$1`, [
    a.user.id,
  ]);
  pass(
    "stale or renewed-but-old session: 401 CSD_REAUTH_REQUIRED before reading files; reads still allowed",
  );

  // --- Configuration, idempotency, replacement -------------------------------------
  const first = material(rfcA);
  await coded(
    await configure(a.ctx, first, { password: syntheticPassword() }),
    400,
    "CSD_PASSWORD_INVALID",
  );
  await coded(
    await configure(a.ctx, first, { accepted: "false" }),
    400,
    "CSD_CUSTODY_TERMS_REQUIRED",
  );
  const created = await json(await configure(a.ctx, first));
  assert.deepEqual(
    [created.created, created.status, created.environment, created.rfc],
    [true, "VALID", "SANDBOX", rfcA],
  );
  assert.equal(created.verification.csdTypeVerifiedLocally, false);
  const again = await json(await configure(admin.ctx, first));
  assert.deepEqual([again.created, again.id], [false, created.id]);
  await resetRateLimits();
  await coded(
    await configure(a.ctx, material(rfcA)),
    409,
    "CSD_ALREADY_ACTIVE",
  );
  await coded(
    await configure(a.ctx, material(rfcA), {
      replace: "true",
      expectedActiveCsdId: "stale",
    }),
    409,
    "CSD_CONFLICT",
  );
  const second = material(rfcA);
  const replaced = await json(
    await configure(admin.ctx, second, {
      replace: "true",
      expectedActiveCsdId: created.id,
    }),
  );
  assert.equal(replaced.created, true);
  assert.deepEqual(
    await sql(
      `SELECT "csdCertificateId" AS id FROM "CsdPrivateKey" WHERE "organizationId"=$1`,
      [a.org.id],
    ),
    [{ id: replaced.id }],
  );
  const history = await json(await a.ctx.get("/api/csd/history"));
  assert.deepEqual(
    history.map((h) => [h.id, h.status, h.configuredBy]),
    [
      [replaced.id, "ACTIVE", "CsdAdminA"],
      [created.id, "REPLACED", "CsdOwnerA"],
    ],
  );
  pass(
    "configure (200), idempotent same certificate, ALREADY_ACTIVE, CONFLICT and replacement that destroys the previous key",
  );

  // --- Validation errors over real multipart ----------------------------------------
  await resetRateLimits();
  const foreign = material(rfcA, syntheticAuthority("OTRA AC SINTETICA"));
  await coded(
    await configure(a.ctx, foreign, {
      replace: "true",
      expectedActiveCsdId: replaced.id,
    }),
    422,
    "CSD_ENVIRONMENT_MISMATCH",
  );
  await coded(
    await a.ctx.post("/api/csd", {
      headers: origin,
      multipart: {
        certificate: {
          name: "certificado.cer",
          mimeType: "application/octet-stream",
          buffer: randomBytes(70 * 1024),
        },
      },
    }),
    413,
    "CSD_FILE_TOO_LARGE",
  );
  await coded(
    await a.ctx.post("/api/csd", {
      headers: origin,
      multipart: { custodyTermsVersion: terms.version, accepted: "true" },
    }),
    400,
    "CSD_FILES_REQUIRED",
  );
  await coded(await configure(b.ctx, material(rfcA)), 422, "CSD_RFC_MISMATCH");
  pass(
    "foreign CA 422 CSD_ENVIRONMENT_MISMATCH, 64 KiB limit 413, missing files 400, RFC mismatch 422",
  );

  // --- Tenant isolation --------------------------------------------------------------
  const bState = await json(await b.ctx.get("/api/csd"));
  assert.equal(bState.status, "NOT_CONFIGURED");
  assert.deepEqual(await json(await b.ctx.get("/api/csd/history")), []);
  assert.equal(
    (await json(await disable(b.ctx, replaced.id))).status,
    "NOT_CONFIGURED",
  );
  await coded(
    await configure(b.ctx, material(rfcB), {
      replace: "true",
      expectedActiveCsdId: replaced.id,
    }),
    409,
    "CSD_CONFLICT",
  );
  const own = await json(await configure(b.ctx, material(rfcB)));
  await coded(await disable(b.ctx, replaced.id), 404, "CSD_NOT_FOUND");
  assert.equal((await json(await a.ctx.get("/api/csd"))).id, replaced.id);
  await json(await disable(b.ctx, own.id));
  pass(
    "Organization B cannot read, list, disable or replace A's CSD (404/409 without revealing it)",
  );

  // --- Disable -----------------------------------------------------------------------
  await coded(await disable(a.ctx, created.id), 409, "CSD_CONFLICT");
  const disabled = await json(await disable(a.ctx, replaced.id));
  assert.equal(disabled.status, "NOT_CONFIGURED");
  assert.deepEqual(
    await sql(`SELECT 1 FROM "CsdPrivateKey" WHERE "organizationId"=$1`, [
      a.org.id,
    ]),
    [],
  );
  assert.equal(
    (await json(await disable(a.ctx, replaced.id))).status,
    "NOT_CONFIGURED",
  );
  await json(
    await a.ctx.post("/api/csd/disable", {
      headers: origin,
      data: { expectedActiveCsdId: replaced.id },
    }),
    400,
  );
  pass(
    "disable requires confirmation, destroys the encrypted key and is idempotent",
  );

  // --- Rate limiting (§T) ------------------------------------------------------------
  await resetRateLimits();
  for (let i = 0; i < 5; i++)
    await coded(
      await configure(a.ctx, first, { password: syntheticPassword() }),
      400,
      "CSD_PASSWORD_INVALID",
    );
  await coded(await configure(a.ctx, first), 429, "CSD_RATE_LIMITED");
  const limited = await audit("csd.configuration.failed", a.org.id);
  assert.deepEqual(limited.at(-1).metadata, {
    errorCode: "CSD_RATE_LIMITED",
    stage: 1,
  });
  pass(
    "configure is limited to 5 attempts per user; the 6th is 429 CSD_RATE_LIMITED and audited",
  );

  // --- Audit and leak checks --------------------------------------------------------
  const events = await sql(
    `SELECT action,metadata FROM "AuditEvent" WHERE action LIKE 'csd.%'`,
  );
  assert.deepEqual([...new Set(events.map((e) => e.action))].sort(), [
    "csd.configuration.failed",
    "csd.configuration.started",
    "csd.configured",
    "csd.disabled",
    "csd.replaced",
  ]);
  assert.deepEqual(
    await sql(
      `SELECT action FROM "ActivityLog" WHERE action ILIKE '%csd%' OR "entityType" ILIKE '%csd%'`,
    ),
    [],
  );
  const html = await (await a.ctx.get("/dashboard")).text();
  const auditText = JSON.stringify(events);
  for (const value of materials) {
    const markers = [
      value.password,
      Buffer.from(value.privateKey).subarray(100, 140).toString("base64"),
      Buffer.from(value.privateKey).subarray(100, 140).toString("hex"),
    ];
    for (const marker of markers)
      for (const [label, text] of [
        ["server logs", logs],
        ["responses", bodies.join("\n")],
        ["audit", auditText],
        ["html", html],
      ])
        assert(!text.includes(marker), `${label} leaks synthetic material`);
  }
  for (const forbidden of [
    "ciphertext",
    "wrappedDek",
    "authTag",
    "kekVersion",
    "certificateDer",
    "-----BEGIN",
  ])
    assert(!bodies.join("\n").includes(forbidden), forbidden);
  assert(
    !/bad decrypt|error:[0-9A-F]{8}|ERR_OSSL/i.test(logs + bodies.join("")),
  );
  pass(
    "synthetic passwords and keys absent from logs, responses, AuditEvent, ActivityLog and HTML",
  );

  // --- Production build: the harness is inert ---------------------------------------
  // `next build` inlines NODE_ENV=production, which removes the harness gate (and the flag
  // value it compares) from the server bundle.
  const serverFiles = await readdir(".next/server", { recursive: true });
  assert(serverFiles.length > 0, "run `npm run build` first");
  for (const file of serverFiles.filter((f) => /\.js$/.test(f)))
    assert(
      !(await readFile(joinPath(".next/server", file), "utf8")).includes(
        sandbox.CSD_E2E_HARNESS,
      ),
      `production bundle still contains the harness gate: ${file}`,
    );
  // Same variables (flag, synthetic CA, loopback PGlite, no Vercel), production runtime.
  await stopApp();
  await startApp("start", sandbox);
  await resetRateLimits();
  // Production uses __Secure- session cookies: sign in on this server.
  const p = await account("CsdOwnerProduction");
  await confirmProfile(p.org, p, rfcA);
  // Fiscal SANDBOX custody is available through the official SAT test CA (AC UAT) only;
  // the synthetic CA of the harness is ignored, so a synthetic CSD is not a test CSD.
  const production = await json(await p.ctx.get("/api/csd"));
  assert.equal(production.serviceAvailable, true);
  await coded(
    await configure(p.ctx, material(rfcA)),
    422,
    "CSD_ENVIRONMENT_MISMATCH",
  );
  assert.equal(
    (await sql(`SELECT 1 FROM "CsdCertificate" WHERE "organizationId"=$1`, [
      p.org.id,
    ])).length,
    0,
  );
  pass(
    "production build ignores the test CA harness even with every harness variable set: synthetic CSD 422 CSD_ENVIRONMENT_MISMATCH, nothing stored",
  );

  // --- Fail closed configurations (production build) -------------------------------
  for (const [label, extra] of [
    [
      "PAC_ENVIRONMENT=PRODUCTION with CSD_KEY_PROVIDER_PRODUCTION=env",
      {
        ...sandbox,
        PAC_ENVIRONMENT: "PRODUCTION",
        CSD_KEY_PROVIDER_PRODUCTION: "env",
      },
    ],
    [
      "PRODUCTION with an unimplemented KMS (no fallback to env)",
      {
        ...sandbox,
        PAC_ENVIRONMENT: "PRODUCTION",
        CSD_KEY_PROVIDER_PRODUCTION: "kms:aws",
      },
    ],
    ["no KeyProvider", { ...sandbox, CSD_KEY_PROVIDER_SANDBOX: "" }],
    [
      "KEK of invalid length",
      { ...sandbox, CSD_KEK_V1: randomBytes(16).toString("base64") },
    ],
  ]) {
    await stopApp();
    await startApp("start", extra);
    await resetRateLimits();
    const unavailable = await json(await p.ctx.get("/api/csd"));
    assert.equal(unavailable.serviceAvailable, false, label);
    await coded(
      await configure(p.ctx, material(rfcA)),
      503,
      "CSD_SERVICE_UNAVAILABLE",
    );
    // Custody is rejected before the body is read: an oversized body is not even parsed.
    await coded(
      await p.ctx.post("/api/csd", {
        headers: origin,
        multipart: {
          certificate: {
            name: "certificado.cer",
            mimeType: "application/octet-stream",
            buffer: randomBytes(70 * 1024),
          },
        },
      }),
      503,
      "CSD_SERVICE_UNAVAILABLE",
    );
  }
  assert.equal(
    (await sql(`SELECT 1 FROM "CsdCertificate" WHERE status='ACTIVE'`)).length,
    0,
  );
  pass(
    "fail closed (503 CSD_SERVICE_UNAVAILABLE): fiscal PRODUCTION, env provider in PRODUCTION, KMS without fallback, no provider, invalid KEK; 503 before reading the body",
  );

  // VERCEL_ENV never decides custody (the fiscal environment does): in fiscal SANDBOX a
  // Vercel signal only disables the harness, so the synthetic CA is not a test CA.
  await stopApp();
  await startApp("start", { ...sandbox, VERCEL_ENV: "production" });
  await resetRateLimits();
  assert.equal(
    (await json(await p.ctx.get("/api/csd"))).serviceAvailable,
    true,
  );
  await coded(
    await configure(p.ctx, material(rfcA)),
    422,
    "CSD_ENVIRONMENT_MISMATCH",
  );
  assert.equal(
    (await sql(`SELECT 1 FROM "CsdCertificate" WHERE status='ACTIVE'`)).length,
    0,
  );
  pass(
    "VERCEL_ENV=production in fiscal SANDBOX: harness off, only the official test CA counts; synthetic CSD 422",
  );

  // Final sweep over every server (dev and production) and every response.
  const everything = logs + "\n" + bodies.join("\n");
  for (const value of materials)
    assert(!everything.includes(value.password), "synthetic password leaked");
  assert(
    !/bad decrypt|error:[0-9A-F]{8}|ERR_OSSL|-----BEGIN/i.test(everything),
  );
  assert(!everything.includes(kekV1), "KEK leaked");
  pass(
    "final sweep: no synthetic password, KEK or OpenSSL detail in any log or response",
  );

  await writeFile(
    "test-results/csd-e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        database: "ephemeral local PGlite; no Neon",
        certificates: "synthetic; they do not prove SAT validity",
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile("test-results/csd-server.log", logs);
  await writeFile(
    "test-results/csd-e2e-summary.json",
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  for (const ctx of contexts) await ctx.dispose();
  await stopApp();
  await database.close();
  // The shared agent instructions must be byte-identical after the run; if a tool
  // changed them, put the original bytes back and fail.
  const changed = [];
  for (const [index, file] of guardedFiles.entries())
    if (!(await readFile(file)).equals(guardedBytes[index])) {
      await writeFile(file, guardedBytes[index]);
      changed.push(file);
    }
  if (changed.length) {
    process.exitCode = 1;
    console.error(
      "Restored files modified during the run: " + changed.join(", "),
    );
  }
}
