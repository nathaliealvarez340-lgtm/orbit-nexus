import test, { mock } from "node:test";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import {
  isPublicAddress,
  validateNavigationUrl,
} from "../src/services/billing/url-security";
import {
  guardedRequest,
  type PortalManifest,
} from "../src/services/billing/local-runner";
import { matchProvider, mapBillingFields } from "../src/lib/billing-fields";
import {
  HttpBillingAutomationRunner,
  GenericManualAdapter,
} from "../src/services/billing/runner";
import {
  Prisma,
  type Company,
  type Expense,
} from "../src/generated/prisma/client";
import type { BillingContext } from "../src/services/billing/types";
import { billingContextHash } from "../src/lib/billing-context-hash";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("billing migration preserves existing tickets and enforces tenant references and one active attempt", async () => {
  const db = await PGlite.create();
  try {
    for (const dir of (await readdir("prisma/migrations"))
      .filter((d) => /^\d/.test(d) && d < "202610010001_ticket_billing")
      .sort())
      await db.exec(
        await readFile(`prisma/migrations/${dir}/migration.sql`, "utf8"),
      );
    await db.exec(`INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('u','Fixture','billing-unit@example.test',NOW());
      INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('a','A',NOW()),('b','B',NOW());
      INSERT INTO "Ticket" (id,"organizationId","userId","fileName","storageKey","mimeType","updatedAt") VALUES ('t','a','u','ticket.png','private','image/png',NOW());`);
    await db.exec(
      await readFile(
        "prisma/migrations/202610010001_ticket_billing/migration.sql",
        "utf8",
      ),
    );
    assert.equal(
      (await db.query<{ n: number }>('SELECT COUNT(*)::int n FROM "Ticket"'))
        .rows[0].n,
      1,
    );
    await db.exec(
      `INSERT INTO "OrganizationBillingProvider" (id,"organizationId",name,domain,"customBillingUrl","updatedAt") VALUES ('pa','a','A','example.com','https://example.com',NOW()),('pb','b','B','example.com','https://example.com',NOW());`,
    );
    const insert = (id: string, org: string, provider: string, active = "t") =>
      db.query(
        `INSERT INTO "BillingAttempt" (id,"organizationId","ticketId","providerId","requestedById","activeKey","idempotencyKey","adapterKey","billingUrl",context,"contextHash","updatedAt") VALUES ($1,$2,'t',$3,'u',$4,$1,'manual','https://example.com','{}','fixture',NOW())`,
        [id, org, provider, active],
      );
    await assert.rejects(() => insert("foreign-ticket", "b", "pb"));
    await assert.rejects(() => insert("foreign-provider", "a", "pb"));
    await insert("owned", "a", "pa");
    await assert.rejects(() => insert("duplicate", "a", "pa"));
    await assert.rejects(() =>
      db.exec(
        `INSERT INTO "BillingAttemptEvent" (id,"organizationId","attemptId",type) VALUES ('e','b','owned','COMPLETED')`,
      ),
    );
    await assert.rejects(() =>
      db.exec(
        `INSERT INTO "Invoice" (id,"organizationId","userId","receiverRfc",subtotal,tax,total,"billingAttemptId","updatedAt") VALUES ('i','b','u','XAXX010101000',0,0,0,'owned',NOW())`,
      ),
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT COUNT(*)::int n FROM "Company" WHERE "automationMode"='AUTOMATED'`,
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("approval fingerprint survives JSONB key reordering but detects altered values or field order", () => {
  const source = {
    user: "a",
    fields: [
      { key: "total", value: "100.50" },
      { key: "rfc", value: "AAA010101AAA" },
    ],
  };
  const stored = {
    fields: [
      { value: "100.50", key: "total" },
      { value: "AAA010101AAA", key: "rfc" },
    ],
    user: "a",
  };
  assert.equal(billingContextHash(source), billingContextHash(stored));
  assert.notEqual(
    billingContextHash(source),
    billingContextHash({ ...stored, user: "b" }),
  );
  assert.notEqual(
    billingContextHash(source),
    billingContextHash({ ...stored, fields: [...stored.fields].reverse() }),
  );
});
const publicDns = async () => [{ address: "93.184.215.14", family: 4 }];
test("runner distinguishes timeout and provider failure; every ambiguous submission is non-retryable", async () => {
  const previousUrl = process.env.BILLING_AUTOMATION_URL,
    previousToken = process.env.BILLING_AUTOMATION_TOKEN;
  try {
    process.env.BILLING_AUTOMATION_URL = "https://example.com/worker";
    process.env.BILLING_AUTOMATION_TOKEN = randomBytes(32).toString("hex");
    const request = mock.method(globalThis, "fetch", async () => {
      throw new DOMException("Fixture timeout", "TimeoutError");
    });
    const runner = new HttpBillingAutomationRunner();
    assert.equal(
      (await runner.run("prepare", {} as BillingContext)).errorCode,
      "AUTOMATION_TIMEOUT",
    );
    assert.equal(
      (await runner.run("submit", {} as BillingContext)).errorCode,
      "SUBMIT_AMBIGUOUS",
    );
    request.mock.mockImplementation(
      async () => new Response("{}", { status: 503 }),
    );
    assert.equal(
      (await runner.run("prepare", {} as BillingContext)).errorCode,
      "PROVIDER_ERROR",
    );
    assert.equal(
      (await runner.run("submit", {} as BillingContext)).errorCode,
      "SUBMIT_AMBIGUOUS",
    );
  } finally {
    mock.restoreAll();
    if (previousUrl === undefined) delete process.env.BILLING_AUTOMATION_URL;
    else process.env.BILLING_AUTOMATION_URL = previousUrl;
    if (previousToken === undefined)
      delete process.env.BILLING_AUTOMATION_TOKEN;
    else process.env.BILLING_AUTOMATION_TOKEN = previousToken;
  }
});
test("SSRF rejects special IPv4/IPv6, mapped addresses, mixed DNS and unsafe schemes", async () => {
  for (const ip of [
    "127.1.1.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.2",
    "169.254.169.254",
    "100.64.1.1",
    "0.0.0.0",
    "224.1.1.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert(isPublicAddress("93.184.215.14"));
  assert(isPublicAddress("2606:4700:4700::1111"));
  for (const url of [
    "https://localhost",
    "http://127.0.0.1",
    "http://[::1]",
    "file:///tmp/x",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "https://example.com:5432",
    "https://invalid.local",
  ])
    await assert.rejects(() =>
      validateNavigationUrl(url, undefined, publicDns),
    );
  await assert.rejects(() =>
    validateNavigationUrl("https://example.com/", undefined, async () => [
      ...(await publicDns()),
      { address: "10.0.0.1", family: 4 },
    ]),
  );
  const first = await validateNavigationUrl(
    "https://example.com/",
    ["example.com"],
    publicDns,
  );
  assert.equal(first.address.address, "93.184.215.14");
  await assert.rejects(() =>
    validateNavigationUrl("https://example.com/", ["example.com"], async () => [
      { address: "127.0.0.1", family: 4 },
    ]),
  );
});
test("network manifest rejects unlisted submission, external resources and private redirects; redirect count bounded", async () => {
  const manifest = {
    allowedHosts: ["example.com"],
    requests: {
      prepare: [{ method: "GET", url: "https://example.com/form" }],
      fill: [],
      submit: [],
      collect: [],
    },
  } as unknown as PortalManifest;
  let calls = 0;
  const redirect = async () => {
    calls++;
    return {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
      body: Buffer.alloc(0),
    };
  };
  await assert.rejects(() =>
    guardedRequest(
      "https://example.com/form",
      "GET",
      manifest,
      "prepare",
      redirect,
    ),
  );
  assert.equal(calls, 1);
  await assert.rejects(() =>
    guardedRequest(
      "https://example.com/form",
      "POST",
      manifest,
      "prepare",
      redirect,
    ),
  );
  assert.equal(calls, 1);
  await assert.rejects(() =>
    guardedRequest(
      "https://other.example.com/form",
      "GET",
      manifest,
      "prepare",
      redirect,
    ),
  );
  calls = 0;
  await assert.rejects(() =>
    guardedRequest(
      "https://example.com/form",
      "GET",
      manifest,
      "prepare",
      async () => {
        calls++;
        return {
          status: 302,
          headers: { location: "/form" },
          body: Buffer.alloc(0),
        };
      },
    ),
  );
  assert.equal(calls, 6);
});
test("provider matching prioritizes exact RFC then domain then normalized name, never fuzzy or inactive", () => {
  const providers = [
    {
      id: "rfc",
      name: "Other",
      merchantRfc: "AAA010101AAA",
      active: true,
      domain: "a.example.com",
    },
    { id: "domain", name: "Comercio B", active: true, domain: "b.example.com" },
    { id: "off", name: "OFF", active: false },
  ] as Company[];
  assert.equal(
    matchProvider(providers, {
      name: "Comercio B",
      rfc: "AAA010101AAA",
      url: "https://b.example.com",
    })?.id,
    "rfc",
  );
  assert.equal(
    matchProvider(providers, {
      name: "Unknown",
      url: "https://b.example.com/a",
    })?.id,
    "domain",
  );
  assert.equal(matchProvider(providers, { name: "Comércio B" })?.id, "domain");
  assert.equal(matchProvider(providers, { name: "Comercio parecido B" }), null);
  assert.equal(matchProvider(providers, { name: "OFF" }), null);
  assert.equal(
    matchProvider([...providers, providers[1]], { name: "Comercio B" }),
    null,
  );
});
test("mapping preserves Decimal precision, identifies missing portal fields and never uses raw OCR", () => {
  const expense = {
    merchant: "Corrected",
    total: new Prisma.Decimal("9999999999.99"),
    purchaseDate: new Date("2026-09-20"),
    folio: "confirmed",
    details: { ticketNumber: "TC1", rawText: "untrusted" },
  } as unknown as Expense;
  const fields = mapBillingFields(expense, null, ["portalSpecific"]);
  assert.equal(fields.find((f) => f.key === "total")?.value, "9999999999.99");
  assert.equal(
    fields.find((f) => f.key === "ticketNumber")?.source,
    "TICKET_CONFIRMED",
  );
  assert(!fields.some((f) => f.key === "rawText"));
  const missing = new GenericManualAdapter().inspectRequirements({
    fields,
  } as BillingContext);
  assert(missing.includes("RFC receptor"));
  assert(missing.includes("portalSpecific"));
});
test("unconfigured HTTP runner and generic adapter explicitly return manual, never fabricated success", async () => {
  const url = process.env.BILLING_AUTOMATION_URL,
    token = process.env.BILLING_AUTOMATION_TOKEN;
  try {
    delete process.env.BILLING_AUTOMATION_URL;
    delete process.env.BILLING_AUTOMATION_TOKEN;
    assert.equal(
      (
        await new HttpBillingAutomationRunner().run(
          "prepare",
          {} as BillingContext,
        )
      ).errorCode,
      "AUTOMATION_NOT_CONFIGURED",
    );
    assert.equal((await new GenericManualAdapter().prepare()).state, "MANUAL");
  } finally {
    if (url !== undefined) process.env.BILLING_AUTOMATION_URL = url;
    if (token !== undefined) process.env.BILLING_AUTOMATION_TOKEN = token;
  }
});
