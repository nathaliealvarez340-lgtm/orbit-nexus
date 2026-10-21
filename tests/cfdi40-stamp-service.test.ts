import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { X509Certificate, createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { resolveCustody } from "../src/lib/csd/custody";
import { csdCustodyTerms } from "../src/lib/csd/custody-terms";
import { createSwPacAdapter } from "../src/lib/pac/sw/adapter";
import { resolveSwPacConfiguration } from "../src/lib/pac/sw/config";
import { stampAuthorizationTerms } from "../src/lib/stamping/terms";
import {
  StampServiceError,
  invoiceStampingState,
  reconcileStampAttempt,
  stampInvoice,
  type StampActor,
  type StampDependencies,
} from "../src/services/cfdi40-stamp";
import { configureCsd, disableCsd } from "../src/services/csd-store";
import type { InvoiceValidationResult } from "../src/types/invoice-studio";
import { startDatabase } from "../scripts/local-database.mjs";
import { issuedAt, validFixtures } from "./fixtures/cfdi40";
import {
  readMultipart,
  simulateStamp,
  stampingKit,
  swJson,
  type SimulatedStamp,
  type StampingKit,
} from "./fixtures/stamping";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.8: the stamping service end to end against PGlite + Prisma (never Neon), with the
// real seal (custodied SYNTHETIC CSD), the real official XSD validation, the REAL SW adapter
// and the real verification of the response. Only the HTTP transport is replaced by a
// SIMULATED SW that follows the documented duplicate rules (same CustomID → CFDI3307, same
// Sello → 307 with the earlier stamp). PGlite runs concurrent transactions one after another,
// so concurrency tests prove the observable outcome; the row lock (FOR UPDATE) that gives the
// same outcome on a real PostgreSQL is standard behavior PGlite cannot show.

const authority = syntheticAuthority();
const authorities = [new X509Certificate(authority.certificate)];
const b64url = () => randomBytes(24).toString("base64url");
const token = `${b64url()}.${b64url()}.${b64url()}`;
const env = {
  PAC_ENVIRONMENT: "SANDBOX",
  STAMPING_ENABLED: "true",
  SW_SANDBOX_TOKEN: token,
  CSD_KEY_PROVIDER_SANDBOX: "env",
  CSD_KEK_ID: "orbit-stamp-service",
  CSD_KEK_CURRENT_VERSION: "1",
  CSD_KEK_V1: randomBytes(32).toString("base64"),
};
const FIXED_NOW = issuedAt;
const material = syntheticCsd(authority, {
  rfc: "SCA010101AB1",
  certificateNumber: "30001000000000000001",
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2036-01-01T00:00:00Z"),
});
const materialB = syntheticCsd(authority, {
  rfc: "SCC030303EF3",
  certificateNumber: "30001000000000000003",
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2036-01-01T00:00:00Z"),
});
const owner: StampActor = {
  organizationId: "org-a",
  userId: "owner-a",
  role: "OWNER",
};
const admin: StampActor = {
  organizationId: "org-a",
  userId: "admin-a",
  role: "ADMIN",
};
const member: StampActor = {
  organizationId: "org-a",
  userId: "member-a",
  role: "MEMBER",
};
const ownerB: StampActor = {
  organizationId: "org-b",
  userId: "owner-b",
  role: "OWNER",
};
const custody = resolveCustody(env, authorities);
const accepted = { accepted: true, version: stampAuthorizationTerms.version };
const ready: InvoiceValidationResult = {
  canMarkReady: true,
  issues: [],
} as unknown as InvoiceValidationResult;

let database: Awaited<ReturnType<typeof startDatabase>>;
let prisma: PrismaClient;
let kit: StampingKit;
const sql = async (query: string, params: unknown[] = []) =>
  (await database.db.query(query, params)).rows as Record<string, unknown>[];

/** SIMULATED SW: documented duplicate rules, scenarios per call, gate to hold a response. */
class FakeSw {
  calls: { customId: string; sha256: string; authorization: string | null }[] =
    [];
  byCustomId = new Map<string, SimulatedStamp>();
  bySello = new Map<string, SimulatedStamp>();
  next: (
    | "stamp"
    | "reject-fiscal"
    | "reject-auth"
    | "lost-after-stamp"
    | "lost-before"
    | "inconsistent"
  )[] = [];
  duplicateCustomId: "uuid-only" | "full" = "uuid-only";
  forceUuid: string | null = null;
  gate: Promise<void> | null = null;
  handle = async (_url: string, init: RequestInit): Promise<Response> => {
    const parts = readMultipart(init);
    assert(parts.wellFormed);
    const xml = Buffer.from(parts.xml).toString("utf8");
    this.calls.push({
      customId: parts.customId!,
      sha256: createHash("sha256").update(parts.xml).digest("hex"),
      authorization: parts.authorization,
    });
    if (this.gate) await this.gate;
    const sello = / Sello="([^"]+)"/.exec(xml)![1];
    const earlier = this.byCustomId.get(parts.customId!);
    if (earlier)
      return swJson(400, {
        message:
          "CFDI3307 - Timbre duplicado. El customId proporcionado está duplicado.",
        messageDetail: null,
        data:
          this.duplicateCustomId === "full"
            ? earlier.data
            : { uuid: earlier.uuid },
        status: "error",
      });
    const previous = this.bySello.get(sello);
    if (previous)
      return swJson(400, {
        message: "307. El comprobante contiene un timbre previo.",
        messageDetail: null,
        data: previous.data,
        status: "error",
      });
    const scenario = this.next.shift() ?? "stamp";
    if (scenario === "reject-fiscal")
      return swJson(400, {
        message:
          "CFDI40119 - El campo Total no corresponde con la suma del subtotal.",
        messageDetail: ". ValorEsperado: 1160.00 ValorReportado: 1160.01",
        data: null,
        status: "error",
      });
    if (scenario === "reject-auth")
      return swJson(401, {
        message: "El token debe contener 3 partes",
        messageDetail: "",
        data: null,
        status: "error",
      });
    if (scenario === "lost-before")
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("socket hang up"), {
          code: "ECONNRESET",
        }),
      });
    const stamp = simulateStamp(
      kit,
      { xml },
      this.forceUuid ? { uuid: this.forceUuid } : {},
    );
    this.byCustomId.set(parts.customId!, stamp);
    this.bySello.set(sello, stamp);
    if (scenario === "lost-after-stamp")
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("socket hang up"), {
          code: "ECONNRESET",
        }),
      });
    if (scenario === "inconsistent")
      return swJson(200, {
        data: {
          ...stamp.data,
          cfdi: stamp.cfdi.replace(/ Total="[0-9.]+"/, ' Total="1.00"'),
        },
        status: "success",
      });
    return swJson(200, { data: stamp.data, status: "success" });
  };
  expireCustomIds() {
    this.byCustomId.clear();
  }
}

let fake: FakeSw;
const deps = (
  overrides: Partial<StampDependencies> = {},
): StampDependencies => ({
  env,
  clock: () => FIXED_NOW,
  custody,
  pac: createSwPacAdapter(resolveSwPacConfiguration(env), {
    transport: fake.handle,
    sleep: async () => undefined,
  }),
  revalidate: async () => ready,
  ...overrides,
});
const errorOf = async (action: Promise<unknown>) => {
  try {
    await action;
    return "OK";
  } catch (error) {
    if (error instanceof StampServiceError)
      return `${error.status} ${error.code}`;
    throw error;
  }
};

let folio = 0;
async function insertInvoice(
  organizationId: string,
  name: keyof typeof validFixtures = "ingreso-pue-iva16",
  overrides: Partial<{
    status: "DRAFT" | "READY";
    version: number;
    userId: string;
  }> = {},
) {
  const f = validFixtures[name].invoice();
  const id = "inv-" + randomBytes(6).toString("hex");
  await prisma.stampedInvoice.create({
    data: {
      id,
      organizationId,
      userId:
        overrides.userId ??
        (organizationId === "org-a" ? "owner-a" : "owner-b"),
      status: overrides.status ?? "READY",
      version: overrides.version ?? 1,
      folio: `ORB-${String(++folio).padStart(6, "0")}`,
      invoiceDate: new Date(f.invoiceDate + "T00:00:00Z"),
      currency: f.currency,
      documentType: f.documentType,
      cfdiUse: f.cfdiUse,
      paymentMethod: f.paymentMethod,
      paymentForm: f.paymentForm,
      exportCode: f.exportCode,
      exchangeRate: f.exchangeRate,
      issuerSnapshot: f.issuerSnapshot as Prisma.InputJsonValue,
      receiverSnapshot: f.receiverSnapshot as Prisma.InputJsonValue,
      issuerRfc: (f.issuerSnapshot as { rfc: string }).rfc,
      receiverRfc: (f.receiverSnapshot as { rfc: string }).rfc,
      subtotal: f.totals.subtotal,
      discount: f.totals.discount,
      tax: f.totals.transferred,
      withheldVat: f.totals.withheldVat,
      withheldIsr: f.totals.withheldIsr,
      total: f.totals.total,
      validation: { canMarkReady: true },
      readyAt: FIXED_NOW,
      concepts: {
        create: f.concepts.map((c) => ({
          position: c.position,
          description: c.description,
          productCode: c.productCode,
          unitCode: c.unitCode,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          discount: c.discount,
          taxObject: c.taxObject,
          vatFactor: c.vatFactor,
          vatRate: c.vatRate,
          taxRate: c.appliedVatRate,
          withholdingVatRate: c.withholdingVatRate,
          withholdingIsrRate: c.withholdingIsrRate,
          subtotal: c.totals.amount,
          transferredTaxes: c.totals.transferred,
          withheldVat: c.totals.withheldVat,
          withheldIsr: c.totals.withheldIsr,
          total: c.totals.amount,
        })),
      },
    },
  });
  return id;
}
const attempts = (invoiceId: string) =>
  prisma.stampAttempt.findMany({
    where: { invoiceId },
    orderBy: { startedAt: "asc" },
  });
const upload = (m: typeof material) => ({
  certificate: { name: "csd.cer", bytes: Buffer.from(m.certificate) },
  privateKey: { name: "csd.key", bytes: Buffer.from(m.privateKey) },
  password: m.password,
  custodyTermsVersion: csdCustodyTerms.version,
  accepted: true,
  replace: false,
  expectedActiveCsdId: null,
});

before(async () => {
  kit = await stampingKit();
  database = await startDatabase();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url, max: 5 }),
  });
  await database.db.exec(`
    INSERT INTO "User" (id,name,email,"updatedAt") VALUES
      ('owner-a','Owner A','owner-a@example.test',NOW()),('admin-a','Admin A','admin-a@example.test',NOW()),
      ('member-a','Member A','member-a@example.test',NOW()),('owner-b','Owner B','owner-b@example.test',NOW());
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-a','Org A',NOW()),('org-b','Org B',NOW());
    INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,"confirmedAt","updatedAt") VALUES
      ('fp-a','owner-a','org-a','SCA010101AB1','EMPRESA SINTETICA DE PRUEBAS','601','06600','G03','a@example.test',NOW(),NOW()),
      ('fp-b','owner-b','org-b','SCC030303EF3','EMPRESA SINTETICA B','601','06600','G03','b@example.test',NOW(),NOW());
    INSERT INTO "StampingEntitlement" ("organizationId",environment,enabled,"updatedAt") VALUES
      ('org-a','SANDBOX',true,NOW()),('org-b','SANDBOX',true,NOW());`);
  await configureCsd(prisma, owner, upload(material), custody, FIXED_NOW, env);
  await configureCsd(
    prisma,
    ownerB,
    upload(materialB),
    custody,
    FIXED_NOW,
    env,
  );
});
beforeEach(() => {
  fake = new FakeSw();
});
after(async () => {
  await prisma?.$disconnect();
  await database?.close();
});

test("gates: flag, entitlement, role, PAC credential, fiscal environment; nothing is written or sent when blocked", async () => {
  const invoiceId = await insertInvoice("org-a");
  const request = { expectedVersion: 1, authorization: accepted };
  const reasons = async (d: StampDependencies, actor = owner) => {
    try {
      await stampInvoice(prisma, actor, invoiceId, request, d);
      return null;
    } catch (error) {
      assert(error instanceof StampServiceError);
      return { status: error.status, code: error.code, reasons: error.reasons };
    }
  };
  const flagOff: Record<string, string | undefined> = {
    ...env,
    STAMPING_ENABLED: undefined,
  };
  assert.deepEqual(await reasons(deps({ env: flagOff })), {
    status: 409,
    code: "STAMPING_DISABLED",
    reasons: ["STAMPING_DISABLED"],
  });
  const noToken: Record<string, string | undefined> = {
    ...env,
    SW_SANDBOX_TOKEN: undefined,
  };
  assert.deepEqual(
    (await reasons(deps({ env: noToken, pac: undefined })))?.reasons,
    ["PAC_NOT_CONFIGURED"],
  );
  const production = { ...env, PAC_ENVIRONMENT: "PRODUCTION" };
  const blocked = await reasons(
    deps({
      env: production,
      pac: undefined,
      custody: resolveCustody(production, authorities),
    }),
  );
  assert(blocked?.reasons.includes("PAC_NOT_CONFIGURED"));
  assert(blocked?.reasons.includes("ORGANIZATION_NOT_ENTITLED"));
  assert.deepEqual(await reasons(deps(), member), {
    status: 403,
    code: "STAMPING_NOT_ALLOWED",
    reasons: ["ROLE_NOT_ALLOWED"],
  });
  await sql(
    `UPDATE "StampingEntitlement" SET enabled=false WHERE "organizationId"='org-a'`,
  );
  assert.deepEqual((await reasons(deps()))?.reasons, [
    "ORGANIZATION_NOT_ENTITLED",
  ]);
  await sql(
    `UPDATE "StampingEntitlement" SET enabled=true, environment='PRODUCTION' WHERE "organizationId"='org-a'`,
  );
  assert.deepEqual((await reasons(deps()))?.reasons, [
    "ORGANIZATION_NOT_ENTITLED",
  ]);
  await sql(
    `UPDATE "StampingEntitlement" SET environment='SANDBOX' WHERE "organizationId"='org-a'`,
  );
  // Privacy notice gate of a production deployment (D14), even in fiscal SANDBOX.
  assert(
    (
      await reasons(deps({ env: { ...env, VERCEL_ENV: "production" } }))
    )?.reasons.includes("PRIVACY_NOTICE_MISSING"),
  );
  assert.equal(fake.calls.length, 0);
  assert.equal(
    (await sql(`SELECT COUNT(*)::int n FROM "StampAttempt"`))[0].n,
    0,
  );
  assert.equal(
    (await sql(`SELECT COUNT(*)::int n FROM "StampAuthorization"`))[0].n,
    0,
  );
});

test("authorization: explicit, of these terms and this version; a stale version or an unchecked box never stamps", async () => {
  const invoiceId = await insertInvoice("org-a");
  for (const [body, expected] of [
    [{ expectedVersion: 1 }, "422 STAMPING_NOT_ALLOWED"],
    [
      {
        expectedVersion: 1,
        authorization: { accepted: false, version: accepted.version },
      },
      "422 STAMPING_NOT_ALLOWED",
    ],
    [
      {
        expectedVersion: 1,
        authorization: { accepted: "true", version: accepted.version },
      },
      "422 STAMPING_NOT_ALLOWED",
    ],
    [
      {
        expectedVersion: 1,
        authorization: { accepted: true, version: "otra-version" },
      },
      "422 STAMPING_NOT_ALLOWED",
    ],
    [{ expectedVersion: "1", authorization: accepted }, "400 INVALID_REQUEST"],
    [{ expectedVersion: 0, authorization: accepted }, "400 INVALID_REQUEST"],
    [null, "400 INVALID_REQUEST"],
    [{ expectedVersion: 2, authorization: accepted }, "409 VERSION_CONFLICT"],
  ] as const)
    assert.equal(
      await errorOf(stampInvoice(prisma, owner, invoiceId, body, deps())),
      expected,
    );
  const draft = await insertInvoice("org-a", "ingreso-pue-iva16", {
    status: "DRAFT",
  });
  assert.equal(
    await errorOf(
      stampInvoice(
        prisma,
        owner,
        draft,
        { expectedVersion: 1, authorization: accepted },
        deps(),
      ),
    ),
    "409 INVOICE_NOT_READY",
  );
  // Fiscal revalidation of the stored invoice still applies at stamping time.
  assert.equal(
    await errorOf(
      stampInvoice(
        prisma,
        owner,
        invoiceId,
        { expectedVersion: 1, authorization: accepted },
        deps({
          revalidate: async () =>
            ({ ...ready, canMarkReady: false }) as InvoiceValidationResult,
        }),
      ),
    ),
    "422 NOT_READY",
  );
  assert.equal(fake.calls.length, 0);
  assert.equal((await attempts(invoiceId)).length, 0);
});

test("success: authorization bound to the version, exact bytes persisted before sending, verified stamp kept, invoice untouched, audited without secrets", async () => {
  const invoiceId = await insertInvoice("org-a", "ingreso-multiples-conceptos");
  const response = await stampInvoice(
    prisma,
    owner,
    invoiceId,
    { expectedVersion: 1, authorization: accepted },
    deps(),
  );
  assert.equal(response.attempt.status, "SUCCEEDED");
  assert.equal(response.attempt.environment, "SANDBOX");
  assert.equal(response.attempt.provider, "SW_SAPIEN");
  assert.equal(response.attempt.draftVersion, 1);
  assert.equal(response.attempt.error, null);
  // Sandbox: the invoice stays READY, same version, no UUID, never ISSUED.
  assert.deepEqual(
    [response.invoice.status, response.invoice.version, response.invoice.uuid],
    ["READY", 1, null],
  );
  const [attempt] = await attempts(invoiceId);
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call.customId, attempt.customId);
  assert.equal(attempt.customId, "orbit-" + attempt.id);
  assert.equal(call.authorization, "Bearer " + token);
  // What SW received is exactly what ORBIT persisted and pinned.
  assert.equal(call.sha256, attempt.requestSha256);
  assert.equal(
    createHash("sha256").update(attempt.sealedXml!).digest("hex"),
    attempt.requestSha256,
  );
  assert.equal(attempt.submissionCount, 1);
  const stamp = fake.byCustomId.get(attempt.customId)!;
  assert.equal(attempt.uuid, stamp.uuid.toLowerCase());
  assert.equal(attempt.stampedAt, "2026-10-12T12:31:00");
  assert.equal(attempt.noCertificadoSat, "30001000000400002495");
  assert.equal(Buffer.from(attempt.stampedXml!).toString("utf8"), stamp.cfdi);
  assert.equal(
    createHash("sha256").update(attempt.stampedXml!).digest("hex"),
    attempt.stampedSha256,
  );
  assert.deepEqual(
    [attempt.activeKey, attempt.succeededKey],
    [null, `org-a:${invoiceId}:1`],
  );
  const authorization = await prisma.stampAuthorization.findUniqueOrThrow({
    where: { id: attempt.authorizationId },
  });
  assert.deepEqual(
    [
      authorization.organizationId,
      authorization.invoiceId,
      authorization.invoiceVersion,
      authorization.userId,
      authorization.termsVersion,
    ],
    ["org-a", invoiceId, 1, "owner-a", stampAuthorizationTerms.version],
  );
  assert.equal(
    authorization.termsSha256,
    createHash("sha256").update(stampAuthorizationTerms.text).digest("hex"),
  );
  const events = await sql(
    `SELECT action, result::text, metadata FROM "AuditEvent" WHERE "targetId"=$1 ORDER BY "createdAt", id`,
    [invoiceId],
  );
  assert.deepEqual(
    events.map((e) => e.action).sort(),
    [
      "cfdi.sealed",
      "cfdi.stamp.authorized",
      "cfdi.stamp.started",
      "cfdi.stamp.succeeded",
      "cfdi.xsd.validated",
    ].sort(),
  );
  const succeeded = events.find((e) => e.action === "cfdi.stamp.succeeded")!;
  assert.deepEqual(succeeded.metadata, {
    stampAttemptId: attempt.id,
    provider: "SW_SAPIEN",
    environment: "SANDBOX",
    resultCode: "PAC_STAMPED",
    uuid: attempt.uuid,
  });
  const text = JSON.stringify(events) + JSON.stringify(response);
  for (const leak of [
    token,
    "<cfdi",
    "Sello",
    "SCA010101AB1",
    "SCB020202CD2",
    stamp.tfd.SelloSAT.slice(0, 20),
    "Certificado",
  ])
    assert(!text.includes(leak), leak);
});

test("idempotency: the same request again (double click, retry, another tab) never stamps twice", async () => {
  const invoiceId = await insertInvoice("org-a");
  const request = { expectedVersion: 1, authorization: accepted };
  const first = await stampInvoice(prisma, owner, invoiceId, request, deps());
  const again = await stampInvoice(prisma, admin, invoiceId, request, deps());
  assert.equal(again.attempt.id, first.attempt.id);
  assert.equal(again.attempt.status, "SUCCEEDED");
  assert.equal(fake.calls.length, 1);
  assert.equal((await attempts(invoiceId)).length, 1);
  assert.equal(
    (
      await sql(
        `SELECT COUNT(*)::int n FROM "StampAuthorization" WHERE "invoiceId"=$1`,
        [invoiceId],
      )
    )[0].n,
    1,
  );
});

test("concurrency: two simultaneous requests from two sessions → one attempt, one PAC call, one UUID", async () => {
  const invoiceId = await insertInvoice("org-a", "ingreso-ppd");
  let release!: () => void;
  fake.gate = new Promise<void>((resolve) => (release = resolve));
  const request = { expectedVersion: 1, authorization: accepted };
  const first = stampInvoice(prisma, owner, invoiceId, request, deps());
  // Let the first request reach the PAC, then a second session repeats it while it is SUBMITTING.
  while (!fake.calls.length) await new Promise((r) => setTimeout(r, 10));
  const second = await stampInvoice(prisma, admin, invoiceId, request, deps());
  assert.equal(second.attempt.status, "SUBMITTING");
  release();
  const done = await first;
  assert.equal(done.attempt.id, second.attempt.id);
  assert.equal(done.attempt.status, "SUCCEEDED");
  // Fully simultaneous starts (no PAC delay) also converge on one attempt.
  const other = await insertInvoice("org-a", "ingreso-exento");
  const results = await Promise.all([
    stampInvoice(prisma, owner, other, request, deps()),
    stampInvoice(prisma, admin, other, request, deps()),
    stampInvoice(prisma, owner, other, request, deps()),
  ]);
  assert.equal(new Set(results.map((r) => r.attempt.id)).size, 1);
  assert.equal(fake.calls.length, 2);
  assert.equal(
    (await attempts(invoiceId)).length + (await attempts(other)).length,
    2,
  );
});

test("explicit rejections fail the attempt (final or retryable) and free the invoice for a new authorized attempt", async () => {
  const invoiceId = await insertInvoice("org-a", "ingreso-descuento");
  const request = { expectedVersion: 1, authorization: accepted };
  fake.next = ["reject-fiscal", "reject-auth"];
  const fiscal = await stampInvoice(prisma, owner, invoiceId, request, deps());
  assert.equal(fiscal.attempt.status, "FAILED");
  assert.equal(fiscal.attempt.error?.code, "PAC_CFDI_REJECTED");
  const auth = await stampInvoice(prisma, owner, invoiceId, request, deps());
  assert.notEqual(auth.attempt.id, fiscal.attempt.id);
  assert.equal(auth.attempt.error?.code, "PAC_AUTH_FAILED");
  const rows = await attempts(invoiceId);
  assert.deepEqual(
    rows.map((r) => [
      r.status,
      r.failureClass,
      r.resultCode,
      r.providerCode,
      r.activeKey,
    ]),
    [
      ["FAILED", "REJECTED_FINAL", "PAC_CFDI_REJECTED", "CFDI40119", null],
      ["FAILED", "REJECTED_RETRYABLE", "PAC_AUTH_FAILED", null, null],
    ],
  );
  assert.notEqual(rows[0].customId, rows[1].customId);
  assert(!JSON.stringify(rows.map((r) => r.providerMessage)).match(/1160/));
  const ok = await stampInvoice(prisma, owner, invoiceId, request, deps());
  assert.equal(ok.attempt.status, "SUCCEEDED");
});

test("UNKNOWN: the PAC may have stamped → no new attempt; reconciliation re-sends the same bytes and CustomID and accepts only verified evidence", async () => {
  const invoiceId = await insertInvoice("org-a", "ingreso-persona-fisica");
  const request = { expectedVersion: 1, authorization: accepted };
  fake.next = ["lost-after-stamp"];
  const lost = await stampInvoice(prisma, owner, invoiceId, request, deps());
  assert.equal(lost.attempt.status, "UNKNOWN");
  assert.equal(lost.attempt.error?.code, "PAC_CONNECTION_LOST");
  assert.equal(lost.attempt.canReconcile, true);
  // Blocked: no blind retry, no new attempt.
  assert.equal(
    await errorOf(stampInvoice(prisma, owner, invoiceId, request, deps())),
    "409 RECONCILIATION_REQUIRED",
  );
  const state = await invoiceStampingState(prisma, owner, invoiceId, deps());
  assert(state.availability.reasons.includes("RECONCILIATION_REQUIRED"));
  // Duplicate CustomID answered with only the UUID (SW v4): still UNKNOWN.
  fake.duplicateCustomId = "uuid-only";
  const pending = await reconcileStampAttempt(prisma, owner, invoiceId, deps());
  assert.equal(pending.attempt.status, "UNKNOWN");
  assert.equal(pending.attempt.error?.code, "PAC_DUPLICATE_CUSTOM_ID");
  // Same CustomID with the full earlier stamp: verified → SUCCEEDED with the original UUID.
  fake.duplicateCustomId = "full";
  const resolved = await reconcileStampAttempt(
    prisma,
    owner,
    invoiceId,
    deps(),
  );
  assert.equal(resolved.attempt.status, "SUCCEEDED");
  assert.equal(resolved.attempt.id, lost.attempt.id);
  const [attempt] = await attempts(invoiceId);
  assert.equal(
    attempt.uuid,
    fake.byCustomId.get(attempt.customId)!.uuid.toLowerCase(),
  );
  assert.equal(attempt.resultCode, "PAC_DUPLICATE_CUSTOM_ID");
  assert.equal(attempt.submissionCount, 3);
  // Every submission: same bytes, same CustomID; the PAC stamped exactly once.
  assert.equal(fake.calls.length, 3);
  assert.equal(new Set(fake.calls.map((c) => c.sha256)).size, 1);
  assert.equal(new Set(fake.calls.map((c) => c.customId)).size, 1);
  assert.equal(fake.bySello.size, 1);
  const events = await sql(
    `SELECT action FROM "AuditEvent" WHERE "targetId"=$1`,
    [invoiceId],
  );
  assert(events.some((e) => e.action === "cfdi.stamp.unknown"));
});

test("reconciliation: request never arrived → stamped now; CustomID expired → duplicate Sello (307) returns the earlier stamp; a rejection keeps UNKNOWN", async () => {
  const request = { expectedVersion: 1, authorization: accepted };
  const never = await insertInvoice("org-a", "ingreso-rfc-generico-nacional");
  fake.next = ["lost-before"];
  assert.equal(
    (await stampInvoice(prisma, owner, never, request, deps())).attempt.status,
    "UNKNOWN",
  );
  const stampedNow = await reconcileStampAttempt(prisma, owner, never, deps());
  assert.equal(stampedNow.attempt.status, "SUCCEEDED");
  assert.equal((await attempts(never))[0].resultCode, "PAC_STAMPED");

  const expired = await insertInvoice("org-a", "ingreso-usd-tipo-cambio");
  fake.next = ["lost-after-stamp"];
  await stampInvoice(prisma, owner, expired, request, deps());
  fake.expireCustomIds();
  // A rejection during reconciliation proves nothing about the first submission.
  fake.gate = null;
  const stillUnknown = await reconcileStampAttempt(
    prisma,
    owner,
    expired,
    deps({
      pac: createSwPacAdapter(resolveSwPacConfiguration(env), {
        transport: async () =>
          swJson(401, {
            message: "El token debe contener 3 partes",
            data: null,
            status: "error",
          }),
      }),
    }),
  );
  assert.equal(stillUnknown.attempt.status, "UNKNOWN");
  assert.equal(
    (await attempts(expired))[0].detailCode,
    "RECONCILIATION_PAC_AUTH_FAILED",
  );
  const viaSello = await reconcileStampAttempt(prisma, owner, expired, deps());
  assert.equal(viaSello.attempt.status, "SUCCEEDED");
  assert.equal(
    (await attempts(expired))[0].resultCode,
    "PAC_PREVIOUSLY_STAMPED",
  );
});

test("reconciliation boundaries: SUCCEEDED and FAILED are terminal (nothing sent); UNKNOWN reconciles without signing again, with the same CustomID and bytes; a requestSha256 mismatch fails closed", async () => {
  const request = { expectedVersion: 1, authorization: accepted };
  // SUCCEEDED is terminal: reconciling returns the state and never calls the PAC.
  const stamped = await insertInvoice("org-a");
  const ok = await stampInvoice(prisma, owner, stamped, request, deps());
  assert.equal(ok.attempt.status, "SUCCEEDED");
  let calls = fake.calls.length;
  const again = await reconcileStampAttempt(prisma, owner, stamped, deps());
  assert.equal(again.attempt.status, "SUCCEEDED");
  assert.equal(again.attempt.id, ok.attempt.id);
  assert.equal(fake.calls.length, calls);
  assert.equal((await attempts(stamped))[0].submissionCount, 1);

  // A known FAILED (explicit rejection) is never re-sent.
  const rejected = await insertInvoice("org-a", "ingreso-descuento");
  fake.next = ["reject-fiscal"];
  assert.equal(
    (await stampInvoice(prisma, owner, rejected, request, deps())).attempt
      .status,
    "FAILED",
  );
  calls = fake.calls.length;
  const stillFailed = await reconcileStampAttempt(
    prisma,
    owner,
    rejected,
    deps(),
  );
  assert.equal(stillFailed.attempt.status, "FAILED");
  assert.equal(fake.calls.length, calls);

  // UNKNOWN: reconciled from the persisted bytes only. Custody under another KEK cannot open
  // the CSD, so the stamp below proves nothing was signed again.
  const lost = await insertInvoice("org-a", "ingreso-persona-fisica");
  fake.next = ["lost-after-stamp"];
  await stampInvoice(prisma, owner, lost, request, deps());
  const [before] = await attempts(lost);
  assert.equal(before.status, "UNKNOWN");
  const sealedEvents = async () =>
    (
      await sql(
        `SELECT COUNT(*)::int n FROM "AuditEvent" WHERE "targetId"=$1 AND action='cfdi.sealed'`,
        [lost],
      )
    )[0].n;
  assert.equal(await sealedEvents(), 1);
  fake.duplicateCustomId = "full";
  calls = fake.calls.length;
  const otherKek = resolveCustody(
    { ...env, CSD_KEK_V1: randomBytes(32).toString("base64") },
    authorities,
  );
  const resolved = await reconcileStampAttempt(
    prisma,
    owner,
    lost,
    deps({ custody: otherKek }),
  );
  assert.equal(resolved.attempt.status, "SUCCEEDED");
  assert.equal(fake.calls.length, calls + 1);
  const call = fake.calls.at(-1)!;
  assert.equal(call.customId, before.customId);
  assert.equal(call.sha256, before.requestSha256);
  const [after] = await attempts(lost);
  assert.equal(after.id, before.id);
  assert.equal(after.customId, before.customId);
  assert(Buffer.from(after.sealedXml!).equals(Buffer.from(before.sealedXml!)));
  assert.equal(after.submissionCount, 2);
  assert.equal(await sealedEvents(), 1, "no new seal during reconciliation");

  // requestSha256 that does not match the stored bytes: the CHECK refuses it even below the
  // triggers; with the CHECK lifted, the service itself refuses to send.
  const mismatch = await insertInvoice("org-a", "ingreso-rfc-generico-nacional");
  fake.next = ["lost-before"];
  await stampInvoice(prisma, owner, mismatch, request, deps());
  const [row] = await attempts(mismatch);
  assert.equal(row.status, "UNKNOWN");
  const wrong = createHash("sha256").update("not the request").digest("hex");
  await assert.rejects(
    belowTriggers(`UPDATE "StampAttempt" SET "requestSha256"=$1 WHERE id=$2`, [
      wrong,
      row.id,
    ]),
    /StampAttempt_request_pinned_check/,
  );
  const [{ definition }] = (await sql(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='StampAttempt_request_pinned_check'`,
  )) as { definition: string }[];
  await database.db.exec(
    `ALTER TABLE "StampAttempt" DROP CONSTRAINT "StampAttempt_request_pinned_check"`,
  );
  try {
    await belowTriggers(
      `UPDATE "StampAttempt" SET "requestSha256"=$1 WHERE id=$2`,
      [wrong, row.id],
    );
    calls = fake.calls.length;
    const refused = await reconcileStampAttempt(
      prisma,
      owner,
      mismatch,
      deps(),
    );
    assert.equal(refused.attempt.status, "UNKNOWN");
    assert.equal(refused.attempt.error?.code, "STORED_REQUEST_CORRUPT");
    assert.equal(fake.calls.length, calls);
  } finally {
    await belowTriggers(
      `UPDATE "StampAttempt" SET "requestSha256"=$1 WHERE id=$2`,
      [row.requestSha256, row.id],
    );
    await database.db.exec(
      `ALTER TABLE "StampAttempt" ADD CONSTRAINT "StampAttempt_request_pinned_check" ${definition}`,
    );
  }
  assert.equal((await attempts(mismatch))[0].customId, row.customId);
});

test("a stamp ORBIT cannot verify is UNKNOWN (never FAILED); a UUID already in ORBIT is never assigned twice", async () => {
  const request = { expectedVersion: 1, authorization: accepted };
  const altered = await insertInvoice("org-a", "ingreso-unicode-escape");
  fake.next = ["inconsistent"];
  const result = await stampInvoice(prisma, owner, altered, request, deps());
  assert.equal(result.attempt.status, "UNKNOWN");
  assert.equal(result.attempt.error?.code, "PAC_RESPONSE_INCONSISTENT");
  const [row] = await attempts(altered);
  assert.deepEqual(
    [row.detailCode, row.uuid, row.stampedXml],
    ["STAMPED_CFDI_CONTENT_CHANGED", null, null],
  );

  const existing = await prisma.stampAttempt.findFirstOrThrow({
    where: { status: "SUCCEEDED" },
  });
  const clash = await insertInvoice("org-a", "ingreso-pue-iva16");
  fake.forceUuid = existing.uuid!.toUpperCase();
  const conflict = await stampInvoice(prisma, owner, clash, request, deps());
  assert.equal(conflict.attempt.status, "UNKNOWN");
  assert.equal(conflict.attempt.error?.code, "PAC_UUID_CONFLICT");
  assert.equal(
    (
      await sql(`SELECT COUNT(*)::int n FROM "StampAttempt" WHERE uuid=$1`, [
        existing.uuid,
      ])
    )[0].n,
    1,
  );
  // The database itself keeps the UUID canonical, so letter case can never bypass uniqueness.
  const unknown = await prisma.stampAttempt.findFirstOrThrow({
    where: { invoiceId: clash },
  });
  for (const value of [existing.uuid!.toUpperCase(), "not-a-uuid"])
    await assert.rejects(
      database.db.query(`UPDATE "StampAttempt" SET uuid=$1 WHERE id=$2`, [
        value,
        unknown.id,
      ]),
      value,
    );
  await assert.rejects(
    database.db.query(`UPDATE "StampAttempt" SET uuid=$1 WHERE id=$2`, [
      existing.uuid,
      unknown.id,
    ]),
  );
});

test("multi-tenant: Organization B can never stamp, read, reconcile or attach to an invoice of A", async () => {
  const invoiceId = await insertInvoice("org-a");
  const request = { expectedVersion: 1, authorization: accepted };
  assert.equal(
    await errorOf(stampInvoice(prisma, ownerB, invoiceId, request, deps())),
    "404 INVOICE_NOT_FOUND",
  );
  assert.equal(
    await errorOf(invoiceStampingState(prisma, ownerB, invoiceId, deps())),
    "404 INVOICE_NOT_FOUND",
  );
  assert.equal(
    await errorOf(reconcileStampAttempt(prisma, ownerB, invoiceId, deps())),
    "404 INVOICE_NOT_FOUND",
  );
  assert.equal(fake.calls.length, 0);
  assert.equal((await attempts(invoiceId)).length, 0);
  // The database refuses an attempt or authorization whose Organization is not the invoice's.
  await assert.rejects(
    database.db.query(
      `INSERT INTO "StampAuthorization" (id,"organizationId","invoiceId","invoiceVersion","userId","termsVersion","termsSha256") VALUES ('x','org-b',$1,1,'owner-b','v',$2)`,
      [invoiceId, "0".repeat(64)],
    ),
  );
  // B's own invoices work with B's own CSD.
  const own = await insertInvoice("org-b", "ingreso-pue-iva16");
  await sql(
    `UPDATE "StampedInvoice" SET "issuerSnapshot"=jsonb_set("issuerSnapshot",'{rfc}','"SCC030303EF3"'), "issuerRfc"='SCC030303EF3' WHERE id=$1`,
    [own],
  );
  const stamped = await stampInvoice(prisma, ownerB, own, request, deps());
  assert.equal(stamped.attempt.status, "SUCCEEDED");
  const rowB = (await attempts(own))[0];
  assert.equal(rowB.organizationId, "org-b");
});

test("stale attempts: nothing sent → FAILED; possibly sent → UNKNOWN; pre-submit failures never reach the PAC", async () => {
  const request = { expectedVersion: 1, authorization: accepted };
  const pendingInvoice = await insertInvoice("org-a");
  const attemptId = "6f1f2c1e-1111-4a4a-9b9b-000000000001";
  await database.db.query(
    `INSERT INTO "StampAuthorization" (id,"organizationId","invoiceId","invoiceVersion","userId","termsVersion","termsSha256") VALUES ($1,'org-a',$2,1,'owner-a',$3,$4)`,
    [
      "auth-stale-1",
      pendingInvoice,
      stampAuthorizationTerms.version,
      "0".repeat(64),
    ],
  );
  await database.db.query(
    `INSERT INTO "StampAttempt" (id,"organizationId","invoiceId","invoiceVersion","authorizationId","requestedById",provider,adapter,environment,"customId","activeKey",status,"startedAt","updatedAt") VALUES ($1,'org-a',$2,1,'auth-stale-1','owner-a','SW_SAPIEN','x','SANDBOX',$3,$4,'SIGNING',$5,NOW())`,
    [
      attemptId,
      pendingInvoice,
      "orbit-" + attemptId,
      "org-a:" + pendingInvoice,
      new Date(FIXED_NOW.getTime() - 10 * 60_000),
    ],
  );
  const fresh = await stampInvoice(
    prisma,
    owner,
    pendingInvoice,
    request,
    deps(),
  );
  assert.equal(fresh.attempt.status, "SUCCEEDED");
  const rows = await attempts(pendingInvoice);
  assert.deepEqual(
    [rows[0].status, rows[0].resultCode],
    ["FAILED", "STALE_PRE_SUBMIT"],
  );

  const submitting = await insertInvoice("org-a");
  let release!: () => void;
  fake.gate = new Promise<void>((resolve) => (release = resolve));
  const baseline = fake.calls.length;
  const running = stampInvoice(prisma, owner, submitting, request, deps());
  // Wait until this request is at the PAC (SUBMITTING, bytes persisted).
  while (fake.calls.length === baseline)
    await new Promise((r) => setTimeout(r, 10));
  // Ten minutes later another request finds it SUBMITTING and stale: UNKNOWN, never FAILED.
  const later = deps({
    clock: () => new Date(FIXED_NOW.getTime() + 10 * 60_000),
  });
  assert.equal(
    await errorOf(stampInvoice(prisma, owner, submitting, request, later)),
    "409 RECONCILIATION_REQUIRED",
  );
  release();
  fake.gate = null;
  const finished = await running;
  // The late answer of the original call cannot overwrite a state another process changed.
  assert.equal(finished.attempt.status, "UNKNOWN");
  fake.duplicateCustomId = "full";
  const reconciled = await reconcileStampAttempt(
    prisma,
    owner,
    submitting,
    later,
  );
  assert.equal(reconciled.attempt.status, "SUCCEEDED");

  // Issue date no longer equal to the draft date: fails before the PAC.
  const dated = await insertInvoice("org-a");
  const nextDay = deps({
    clock: () => new Date(FIXED_NOW.getTime() + 24 * 3600_000),
  });
  const calls = fake.calls.length;
  const failed = await stampInvoice(prisma, owner, dated, request, nextDay);
  assert.equal(failed.attempt.status, "FAILED");
  assert.equal(failed.attempt.error?.code, "ISSUE_DATE_DIFFERS_FROM_DRAFT");
  assert.equal((await attempts(dated))[0].failureClass, "PRE_SUBMIT");
  assert.equal(fake.calls.length, calls);
});

/** Writes below the immutability triggers (simulated storage corruption); CHECKs still apply. */
async function belowTriggers(statement: string, params: unknown[]) {
  await database.db.exec("SET session_replication_role = replica");
  try {
    return await database.db.query(statement, params);
  } finally {
    await database.db.exec("SET session_replication_role = origin");
  }
}

test("reconciliation refuses tampered stored bytes: the database refuses the change; corruption below it → UNKNOWN STORED_REQUEST_CORRUPT and nothing is sent", async () => {
  const invoiceId = await insertInvoice("org-a", "ingreso-descuento");
  fake.next = ["lost-before"];
  await stampInvoice(
    prisma,
    owner,
    invoiceId,
    { expectedVersion: 1, authorization: accepted },
    deps(),
  );
  const [row] = await attempts(invoiceId);
  const tampered = Buffer.from(
    Buffer.from(row.sealedXml!)
      .toString("utf8")
      .replace(/Total="([0-9.]+)"/, 'Total="1.00"'),
  );
  const tamperedSha256 = createHash("sha256").update(tampered).digest("hex");
  // The persisted request is immutable (trigger) and pinned by its hash (CHECK).
  await assert.rejects(
    prisma.stampAttempt.update({
      where: { id: row.id },
      data: { sealedXml: new Uint8Array(tampered) },
    }),
    /STAMP_ATTEMPT_REQUEST_IMMUTABLE/,
  );
  await assert.rejects(
    belowTriggers(`UPDATE "StampAttempt" SET "sealedXml"=$1 WHERE id=$2`, [
      tampered,
      row.id,
    ]),
    /StampAttempt_request_pinned_check/,
  );
  // Corrupted below the triggers with a consistent hash: the restore still refuses it (the
  // signed cadena and the Sello no longer match), so nothing is sent.
  await belowTriggers(
    `UPDATE "StampAttempt" SET "sealedXml"=$1, "requestSha256"=$2 WHERE id=$3`,
    [tampered, tamperedSha256, row.id],
  );
  const calls = fake.calls.length;
  const result = await reconcileStampAttempt(prisma, owner, invoiceId, deps());
  assert.equal(result.attempt.status, "UNKNOWN");
  assert.equal(result.attempt.error?.code, "STORED_REQUEST_CORRUPT");
  assert.equal(fake.calls.length, calls);
  // Restoring the exact bytes makes it reconcilable again.
  await belowTriggers(
    `UPDATE "StampAttempt" SET "sealedXml"=$1, "requestSha256"=$2 WHERE id=$3`,
    [Buffer.from(row.sealedXml!), row.requestSha256, row.id],
  );
  assert.equal(
    (await reconcileStampAttempt(prisma, owner, invoiceId, deps())).attempt
      .status,
    "SUCCEEDED",
  );
});

test("a disabled CSD blocks new attempts before anything is created; the token is never stored", async () => {
  const invoiceId = await insertInvoice("org-a");
  const before = await prisma.csdCertificate.findFirstOrThrow({
    where: { organizationId: "org-a", status: "ACTIVE" },
  });
  await disableCsd(
    prisma,
    owner,
    { expectedActiveCsdId: before.id },
    custody,
    FIXED_NOW,
    env,
  );
  const blocked = await errorOf(
    stampInvoice(
      prisma,
      owner,
      invoiceId,
      { expectedVersion: 1, authorization: accepted },
      deps(),
    ),
  );
  assert.equal(blocked, "409 CSD_NOT_VALID");
  assert.equal((await attempts(invoiceId)).length, 0);
  const dump =
    JSON.stringify(
      await sql(
        `SELECT a.*, encode(a."sealedXml",'escape') s, encode(a."stampedXml",'escape') t FROM "StampAttempt" a`,
      ),
    ) +
    JSON.stringify(await sql(`SELECT * FROM "AuditEvent"`)) +
    JSON.stringify(await sql(`SELECT * FROM "StampAuthorization"`));
  assert(!dump.includes(token));
  assert(!dump.includes(token.split(".")[1]));
});
