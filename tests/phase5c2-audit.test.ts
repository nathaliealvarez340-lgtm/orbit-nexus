import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { recordAuditEvent } from "../src/lib/audit";
import { listAuditEvents } from "../src/services/audit-events";
import {
  acceptLegalDocument,
  legalAcceptanceStates,
} from "../src/services/legal-acceptances";
import { buildLegalDocument } from "../src/lib/legal/registry";
import { postgresRateLimitStore } from "../src/lib/security/rate-limit";
import { startDatabase } from "../scripts/local-database.mjs";

const migration = "202610090001_phase5c2_legal_security";
const before5C2 = [
  "202609200001_phase1",
  "202609200002_multitenant",
  "202609270001_phase3",
  "202609300001_ticket_intelligence",
  "202610010001_ticket_billing",
  "202610070001_phase5_fiscal_foundation",
  "202610080001_phase5c_fiscal_identity",
];

test("phase 5C.2 migration is additive and audit events are append-only", async () => {
  const sql = await readFile(
    `prisma/migrations/${migration}/migration.sql`,
    "utf8",
  );
  assert(
    !/\bDROP\b|\bDELETE\s+FROM\b|ALTER\s+COLUMN|\bTRUNCATE\b|ALTER\s+TABLE\s+"(?!AuditEvent|LegalAcceptance)/i.test(
      sql,
    ),
  );
  const available = new Set(await readdir("prisma/migrations"));
  for (const name of [...before5C2, migration])
    assert(available.has(name), name + " migration is missing");
  const db = await PGlite.create();
  try {
    for (const name of before5C2)
      await db.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
    await db.exec(`
      INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('u','U','u@example.test',NOW());
      INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('o','O',NOW());
      INSERT INTO "ActivityLog" (id,"organizationId","userId",action,"entityType") VALUES ('log','o','u','LOGIN','Session');`);
    await db.exec(sql);
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM "ActivityLog"`,
        )
      ).rows[0].n,
      1,
      "existing rows are preserved",
    );
    await db.exec(
      `INSERT INTO "AuditEvent" (id,"organizationId","actorUserId",action,"targetType") VALUES ('e','o','u','sensitive_asset.uploaded','Document')`,
    );
    await assert.rejects(
      db.exec(`UPDATE "AuditEvent" SET action='x'`),
      /append-only/,
    );
    await assert.rejects(
      db.exec(`UPDATE "AuditEvent" SET metadata='{"a":1}'`),
      /append-only/,
    );
    await assert.rejects(db.exec(`DELETE FROM "AuditEvent"`), /append-only/);
    // An Organization with audit history cannot be deleted silently.
    await assert.rejects(db.exec(`DELETE FROM "Organization" WHERE id='o'`));
    // Deleting a user only detaches the actor; the event stays.
    await db.exec(
      `DELETE FROM "Membership"; DELETE FROM "ActivityLog"; DELETE FROM "User" WHERE id='u'`,
    );
    const event = await db.query<{
      actorUserId: string | null;
      action: string;
    }>(`SELECT "actorUserId", action FROM "AuditEvent" WHERE id='e'`);
    assert.deepEqual(event.rows[0], {
      actorUserId: null,
      action: "sensitive_asset.uploaded",
    });
    await db.exec(
      `INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('v','V','v@example.test',NOW())`,
    );
    await db.exec(
      `INSERT INTO "LegalAcceptance" (id,"userId",document,version,"contentHash") VALUES ('a1','v','TERMS','v1','h')`,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "LegalAcceptance" (id,"userId",document,version,"contentHash") VALUES ('a2','v','TERMS','v1','h')`,
      ),
    );
  } finally {
    await db.close();
  }
});

let database: Awaited<ReturnType<typeof startDatabase>>;
let prisma: PrismaClient;
before(async () => {
  database = await startDatabase();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url, max: 5 }),
  });
  await database.db.exec(`
    INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('user-a','A','a@example.test',NOW()),('user-b','B','b@example.test',NOW());
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-a','Org A',NOW()),('org-b','Org B',NOW());`);
});
after(async () => {
  await prisma?.$disconnect();
  await database?.close();
});

test("audit events stay inside their Organization and account events in no Organization", async () => {
  for (const [organizationId, actorUserId] of [
    ["org-a", "user-a"],
    ["org-b", "user-b"],
  ])
    await recordAuditEvent(prisma, {
      action: "client.fiscal.updated",
      organizationId,
      actorUserId,
      targetId: "client-" + organizationId,
      metadata: {
        operation: "UPDATE",
        changedFields: ["rfc"],
        source: "MANUAL",
        rfc: "XAXX010101000",
      },
    });
  await recordAuditEvent(prisma, {
    action: "csf.extraction_requested",
    organizationId: "org-a",
    actorUserId: "user-b",
    targetId: "consent-a",
    result: "DENIED",
    metadata: {
      purpose: "FISCAL_PROFILE_PREFILL",
      reason: "CONSENT_OF_ANOTHER_USER",
    },
  });
  await recordAuditEvent(prisma, {
    action: "legal.accepted",
    organizationId: null,
    actorUserId: "user-a",
    metadata: { document: "TERMS", version: "v1" },
  });
  const a = await listAuditEvents(prisma, "org-a");
  const b = await listAuditEvents(prisma, "org-b");
  assert.deepEqual(
    a.events.map((e) => [e.action, e.targetId, e.result]),
    [
      ["csf.extraction_requested", "consent-a", "DENIED"],
      ["client.fiscal.updated", "client-org-a", "SUCCESS"],
    ],
  );
  assert.deepEqual(
    b.events.map((e) => e.targetId),
    ["client-org-b"],
  );
  assert.deepEqual(a.events[1].metadata, {
    operation: "UPDATE",
    changedFields: ["rfc"],
    source: "MANUAL",
  });
  assert.deepEqual(a.events[1].actor, { id: "user-a", name: "A" });
  assert(
    ![...a.events, ...b.events].some((e) => e.action === "legal.accepted"),
    "account events are never listed for an Organization",
  );
  const stored = await database.db.query<{ organizationId: string | null }>(
    `SELECT "organizationId" FROM "AuditEvent" WHERE action='legal.accepted'`,
  );
  assert.equal(stored.rows[0].organizationId, null);
  // Pagination stays inside the Organization.
  const first = await listAuditEvents(prisma, "org-a", { limit: "1" });
  assert.equal(first.events.length, 1);
  assert(first.nextBefore);
  const second = await listAuditEvents(prisma, "org-a", {
    before: first.nextBefore,
    limit: "5",
  });
  assert(second.events.every((e) => e.id !== first.events[0].id));
});

test("legal acceptance is idempotent per user and version, also under concurrency", async () => {
  const published = buildLegalDocument(
    "PRIVACY_NOTICE",
    {
      controller: {
        name: "Responsable sintético de prueba",
        address: "Domicilio sintético de prueba",
      },
      privacyContact: "privacidad@example.test",
      termsContact: null,
      retentionStatement: "Plazos sintéticos de prueba.",
      providerDisclosure: "Proveedores sintéticos de prueba.",
      governingLawAndJurisdiction: null,
    },
    {
      version: "aviso-test-1",
      status: "PUBLISHED",
      effectiveDate: "2026-11-01",
      legalReviewApproved: true,
    },
  );
  const current = (kind: "TERMS" | "PRIVACY_NOTICE") =>
    kind === "PRIVACY_NOTICE" ? published : buildLegalDocument("TERMS");
  const body = {
    document: "PRIVACY_NOTICE",
    version: published.version,
    contentHash: published.contentHash,
  };
  const results = await Promise.all([
    acceptLegalDocument(prisma, "user-b", body, current),
    acceptLegalDocument(prisma, "user-b", body, current),
  ]);
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal(
    (await acceptLegalDocument(prisma, "user-b", body, current)).created,
    false,
  );
  const rows = await database.db.query<{ n: number; events: number }>(
    `SELECT (SELECT COUNT(*)::int FROM "LegalAcceptance" WHERE "userId"='user-b') AS n,
            (SELECT COUNT(*)::int FROM "AuditEvent" WHERE action='privacy.accepted' AND "actorUserId"='user-b' AND "organizationId" IS NULL) AS events`,
  );
  assert.deepEqual(rows.rows[0], { n: 1, events: 1 });
  const states = await legalAcceptanceStates(prisma, "user-b", current);
  const notice = states.find((s) => s.document === "PRIVACY_NOTICE")!;
  assert.equal(notice.accepted, true);
  assert.equal(notice.acceptable, true);
  const terms = states.find((s) => s.document === "TERMS")!;
  assert.deepEqual(
    [terms.accepted, terms.acceptable, terms.status],
    [false, false, "DRAFT"],
  );
  // Another user's acceptance is independent.
  assert.equal(
    (await legalAcceptanceStates(prisma, "user-a", current)).find(
      (s) => s.document === "PRIVACY_NOTICE",
    )!.accepted,
    false,
  );
});

test("rate limit counters are atomic in shared storage and reset per window", async () => {
  const store = postgresRateLimitStore(prisma);
  const now = new Date("2026-10-09T12:00:00Z");
  const counts = await Promise.all(
    Array.from({ length: 12 }, () => store.hit("test-key", 60, now)),
  );
  assert.deepEqual(
    [...counts].sort((x, y) => x - y),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  assert.equal(
    await store.hit("test-key", 60, new Date(now.getTime() + 59_000)),
    13,
  );
  assert.equal(
    await store.hit("test-key", 60, new Date(now.getTime() + 61_000)),
    1,
  );
  assert.equal(await store.hit("other-key", 60, now), 1);
});
