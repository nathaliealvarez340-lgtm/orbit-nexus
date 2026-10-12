import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { X509Certificate, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { resolveCustody } from "../src/lib/csd/custody";
import { csdCustodyTerms } from "../src/lib/csd/custody-terms";
import { CsdError } from "../src/lib/csd/errors";
import type { CsdKeyProvider } from "../src/lib/csd/key-provider";
import {
  configureCsd,
  disableCsd,
  listCsdHistory,
  readCsdState,
  verifyActiveCsdEnvelope,
  type CsdActor,
  type ConfigureCsdInput,
} from "../src/services/csd-store";
import { startDatabase } from "../scripts/local-database.mjs";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.3 §AC (integration): PGlite + Prisma, never Neon. Certificates are SYNTHETIC and
// signed by a synthetic CA injected as an argument: they do NOT prove SAT validity.

const migration = "202610110001_phase5c3_csd_custody";
const authority = syntheticAuthority();
const authorities = [new X509Certificate(authority.certificate)];
const env = {
  CSD_KEY_PROVIDER_SANDBOX: "env",
  CSD_KEK_ID: "orbit-csd-integration",
  CSD_KEK_CURRENT_VERSION: "1",
  CSD_KEK_V1: randomBytes(32).toString("base64"),
};
const custody = resolveCustody(env, authorities);
const rfcA = "SCA010101AB1";
const rfcB = "SCB020202CD2";
const day = 24 * 3600 * 1000;
const actors = {
  ownerA: { organizationId: "org-a", userId: "owner-a", role: "OWNER" },
  adminA: { organizationId: "org-a", userId: "admin-a", role: "ADMIN" },
  memberA: { organizationId: "org-a", userId: "member-a", role: "MEMBER" },
  ownerB: { organizationId: "org-b", userId: "owner-b", role: "OWNER" },
  ownerC: { organizationId: "org-c", userId: "owner-c", role: "OWNER" },
  ownerR: { organizationId: "org-race", userId: "owner-r", role: "OWNER" },
} satisfies Record<string, CsdActor>;
type Material = ReturnType<typeof syntheticCsd>;
const materials: Material[] = [];
const csdFor = (
  rfc: string,
  options: Parameters<typeof syntheticCsd>[1] = {},
) => {
  const material = syntheticCsd(authority, { rfc, ...options });
  materials.push(material);
  return material;
};

function input(
  material: Material,
  extra: Partial<ConfigureCsdInput> = {},
): ConfigureCsdInput {
  return {
    certificate: { name: "csd.cer", bytes: Buffer.from(material.certificate) },
    privateKey: { name: "csd.key", bytes: Buffer.from(material.privateKey) },
    password: material.password,
    custodyTermsVersion: csdCustodyTerms.version,
    accepted: true,
    replace: false,
    expectedActiveCsdId: null,
    ...extra,
  };
}

let database: Awaited<ReturnType<typeof startDatabase>>;
let prisma: PrismaClient;
const configure = (
  actor: CsdActor,
  material: Material,
  extra: Partial<ConfigureCsdInput> = {},
  options: { custody?: typeof custody; now?: Date } = {},
) =>
  configureCsd(
    prisma,
    actor,
    input(material, extra),
    options.custody ?? custody,
    options.now,
    env,
  );
const state = (actor: CsdActor, now?: Date, environment = env, c = custody) =>
  readCsdState(prisma, actor, c, now, environment);
const sql = async <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
) => (await database.db.query<T>(query, params)).rows;
async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert(error instanceof CsdError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

before(async () => {
  database = await startDatabase();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url, max: 5 }),
  });
  await database.db.exec(`
    INSERT INTO "User" (id,name,email,"updatedAt") VALUES
      ('owner-a','Owner A','owner-a@example.test',NOW()),('admin-a','Admin A','admin-a@example.test',NOW()),
      ('member-a','Member A','member-a@example.test',NOW()),('owner-b','Owner B','owner-b@example.test',NOW()),
      ('owner-c','Owner C','owner-c@example.test',NOW()),('owner-r','Owner R','owner-r@example.test',NOW());
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES
      ('org-a','Org A',NOW()),('org-b','Org B',NOW()),('org-c','Org C',NOW()),('org-race','Org R',NOW());
    INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,"confirmedAt","updatedAt") VALUES
      ('fp-a','owner-a','org-a','${rfcA}','EMPRESA SINTETICA A','601','42501','G03','a@example.test',NOW(),NOW()),
      ('fp-b','owner-b','org-b','${rfcB}','EMPRESA SINTETICA B','601','42501','G03','b@example.test',NOW(),NOW()),
      ('fp-c','owner-c','org-c','XAXX010101000','EMPRESA SINTETICA C','601','42501','G03','c@example.test',NULL,NOW()),
      ('fp-r','owner-r','org-race','${rfcA}','EMPRESA SINTETICA R','601','42501','G03','r@example.test',NOW(),NOW());`);
});
after(async () => {
  await prisma?.$disconnect();
  await database?.close();
});

test("CSD migration is additive and its constraints hold in the database", async () => {
  const text = await readFile(
    `prisma/migrations/${migration}/migration.sql`,
    "utf8",
  );
  assert(
    !/\bDROP\b|\bDELETE\s+FROM\b|ALTER\s+COLUMN|\bTRUNCATE\b|ALTER\s+TABLE\s+"(?!CsdCertificate|CsdPrivateKey)/i.test(
      text,
    ),
  );
  const previous = (await readdir("prisma/migrations"))
    .filter((name) => /^\d/.test(name) && name < migration)
    .sort();
  const db = await PGlite.create();
  try {
    for (const name of previous)
      await db.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
    await db.exec(`
      INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('u','U','u@example.test',NOW());
      INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('o','O',NOW()),('p','P',NOW());
      INSERT INTO "AuditEvent" (id,"organizationId","actorUserId",action,"targetType") VALUES ('e','o','u','csf.uploaded','Document');`);
    await db.exec(text);
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM "AuditEvent"`,
        )
      ).rows[0].n,
      1,
      "existing rows are preserved",
    );
    const row = (
      id: string,
      status: string,
      marker: string | null,
      org = "o",
    ) =>
      db.exec(`INSERT INTO "CsdCertificate" (id,"organizationId",status,"activeOrganizationId",environment,"certificateDer","certificateSha256","serialNumberHex","certificateNumber",rfc,"publicKeyAlgorithm","publicKeyBits","signatureAlgorithm","validFrom","validTo","custodyConsentVersion","updatedAt")
        VALUES ('${id}','${org}','${status}',${marker === null ? "NULL" : `'${marker}'`},'SANDBOX','\\x00','h','s','n','r','RSA',2048,'a',NOW(),NOW(),'v',NOW())`);
    await row("c1", "ACTIVE", "o");
    await assert.rejects(row("c2", "ACTIVE", "o"), /unique/i);
    await assert.rejects(row("c3", "ACTIVE", null), /active_marker_check/);
    await assert.rejects(row("c4", "REPLACED", "o"), /check/);
    await assert.rejects(row("c5", "ACTIVE", "p"), /tenant_check/);
    await row("c6", "REPLACED", null);
    await row("c7", "ACTIVE", "p", "p");
    const key = (cert: string, org: string) =>
      db.exec(`INSERT INTO "CsdPrivateKey" ("csdCertificateId","organizationId","envelopeVersion",algorithm,ciphertext,iv,"authTag","wrappedDek","kekProvider","kekId","kekVersion","aadVersion")
        VALUES ('${cert}','${org}',1,'AES-256-GCM','\\x01','\\x02','\\x03','\\x04','env','k',1,1)`);
    // The composite FK forbids an envelope pointing to another Organization's certificate.
    await assert.rejects(key("c1", "p"), /foreign key/i);
    await key("c1", "o");
    // Deleting a certificate cascades to its envelope; an Organization with CSD is restricted.
    await assert.rejects(
      db.exec(`DELETE FROM "Organization" WHERE id='p'`),
      /foreign key/i,
    );
    await db.exec(`DELETE FROM "CsdCertificate" WHERE id='c1'`);
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM "CsdPrivateKey"`,
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

let firstA: Material;
let firstAId: string;

test("configure: validates, encrypts and stores one ACTIVE CSD with its envelope", async () => {
  firstA = csdFor(rfcA);
  const result = await configure(actors.ownerA, firstA);
  assert.equal(result.created, true);
  assert.equal(result.status, "VALID");
  assert.equal(result.invalidReason, null);
  assert.equal(result.environment, "SANDBOX");
  assert.equal(result.certificateNumber, firstA.certificateNumber);
  assert.equal(result.rfc, rfcA);
  assert.deepEqual(result.verification, {
    keyMatchesCertificate: true,
    rfcMatchesIssuer: true,
    withinValidity: true,
    csdTypeVerifiedLocally: false,
  });
  assert.deepEqual([result.canManage, result.serviceAvailable], [true, true]);
  firstAId = result.id!;
  const [certificate] = await sql<Record<string, unknown>>(
    `SELECT status,"activeOrganizationId","csdTypeVerifiedLocally","custodyConsentVersion","configuredById",environment FROM "CsdCertificate" WHERE id=$1`,
    [firstAId],
  );
  assert.deepEqual(certificate, {
    status: "ACTIVE",
    activeOrganizationId: "org-a",
    csdTypeVerifiedLocally: false,
    custodyConsentVersion: csdCustodyTerms.version,
    configuredById: "owner-a",
    environment: "SANDBOX",
  });
  const [envelope] = await sql<Record<string, number | string>>(
    `SELECT length(iv) AS iv,length("authTag") AS tag,length("wrappedDek") AS wrapped,"kekProvider","kekId","kekVersion","envelopeVersion","aadVersion",algorithm FROM "CsdPrivateKey" WHERE "csdCertificateId"=$1 AND "organizationId"='org-a'`,
    [firstAId],
  );
  assert.deepEqual(envelope, {
    iv: 12,
    tag: 16,
    wrapped: 60,
    kekProvider: "env",
    kekId: "orbit-csd-integration",
    kekVersion: 1,
    envelopeVersion: 1,
    aadVersion: 1,
    algorithm: "AES-256-GCM",
  });
  assert.equal(await verifyActiveCsdEnvelope(prisma, "org-a", env), "OK");
  const configured = await sql(
    `SELECT metadata,"targetId",result FROM "AuditEvent" WHERE action='csd.configured' AND "organizationId"='org-a'`,
  );
  assert.deepEqual(configured, [
    {
      metadata: {
        certificateNumber: firstA.certificateNumber,
        environment: "SANDBOX",
        validTo: result.validTo,
        created: true,
      },
      targetId: firstAId,
      result: "SUCCESS",
    },
  ]);
});

test("configure is idempotent with the same certificate and rejects another without replace", async () => {
  const before = await sql<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "CsdCertificate"`,
  );
  for (const extra of [{}, { replace: true, expectedActiveCsdId: "stale" }]) {
    const again = await configure(actors.adminA, firstA, extra);
    assert.deepEqual(
      [again.created, again.id, again.status],
      [false, firstAId, "VALID"],
    );
  }
  assert.deepEqual(
    await sql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "CsdCertificate"`),
    before,
  );
  // Same certificate but a wrong password is never "idempotent".
  await rejectsWith(
    configure(actors.ownerA, firstA, { password: firstA.password + "x" }),
    "CSD_PASSWORD_INVALID",
  );
  await rejectsWith(
    configure(actors.ownerA, csdFor(rfcA)),
    "CSD_ALREADY_ACTIVE",
  );
  await rejectsWith(
    configure(actors.ownerA, csdFor(rfcA), {
      replace: true,
      expectedActiveCsdId: "x",
    }),
    "CSD_CONFLICT",
  );
  await rejectsWith(configure(actors.memberA, csdFor(rfcA)), "CSD_FORBIDDEN");
  const failures = await sql<{
    metadata: Record<string, unknown>;
    result: string;
  }>(
    `SELECT metadata,result FROM "AuditEvent" WHERE action='csd.configuration.failed' AND "organizationId"='org-a' ORDER BY "createdAt"`,
  );
  assert.deepEqual(
    failures.map((f) => [f.metadata, f.result]),
    [
      [{ errorCode: "CSD_PASSWORD_INVALID", stage: 10 }, "FAILURE"],
      [{ errorCode: "CSD_ALREADY_ACTIVE" }, "FAILURE"],
      [{ errorCode: "CSD_CONFLICT" }, "FAILURE"],
      [{ errorCode: "CSD_FORBIDDEN", stage: 1 }, "FAILURE"],
    ],
  );
  assert.equal((await state(actors.ownerA)).id, firstAId);
});

let secondAId: string;

test("replace: previous CSD becomes REPLACED and its private key is destroyed in the same transaction", async () => {
  const second = csdFor(rfcA);
  const result = await configure(actors.adminA, second, {
    replace: true,
    expectedActiveCsdId: firstAId,
  });
  assert.equal(result.created, true);
  secondAId = result.id!;
  const [old] = await sql<Record<string, unknown>>(
    `SELECT status,"activeOrganizationId","endedById","replacedById","endedAt" IS NOT NULL AS ended,"certificateDer" IS NOT NULL AS der FROM "CsdCertificate" WHERE id=$1`,
    [firstAId],
  );
  assert.deepEqual(old, {
    status: "REPLACED",
    activeOrganizationId: null,
    endedById: "admin-a",
    replacedById: secondAId,
    ended: true,
    der: true,
  });
  assert.deepEqual(
    (
      await sql<{ id: string }>(
        `SELECT "csdCertificateId" AS id FROM "CsdPrivateKey" WHERE "organizationId"='org-a'`,
      )
    ).map((r) => r.id),
    [secondAId],
  );
  const [replaced] = await sql<{ metadata: unknown; targetId: string }>(
    `SELECT metadata,"targetId" FROM "AuditEvent" WHERE action='csd.replaced'`,
  );
  assert.deepEqual(replaced, {
    metadata: {
      previousCertificateId: firstAId,
      certificateNumber: second.certificateNumber,
    },
    targetId: secondAId,
  });
  const history = await listCsdHistory(prisma, "org-a");
  assert.deepEqual(
    history.map((h) => [h.id, h.status, h.configuredBy]),
    [
      [secondAId, "ACTIVE", "Admin A"],
      [firstAId, "REPLACED", "Owner A"],
    ],
  );
  assert.equal(history[1].endedAt !== null, true);
  // A failure while replacing changes nothing (the round trip runs before any write).
  const broken = { ...env, CSD_KEK_V1: "" };
  await rejectsWith(
    configure(
      actors.ownerA,
      csdFor(rfcA),
      { replace: true, expectedActiveCsdId: secondAId },
      {
        custody: {
          ...custody,
          provider: resolveCustody(broken, authorities).provider,
        },
      },
    ),
    "CSD_SERVICE_UNAVAILABLE",
  );
  assert.equal((await state(actors.ownerA)).id, secondAId);
  assert.equal(await verifyActiveCsdEnvelope(prisma, "org-a", env), "OK");
});

test("tenant isolation: Organization B cannot read, list, disable or replace A's CSD", async () => {
  assert.equal((await state(actors.ownerB)).status, "NOT_CONFIGURED");
  assert.deepEqual(await listCsdHistory(prisma, "org-b"), []);
  // B has nothing active: disabling is idempotent for B and never touches A.
  assert.equal(
    (
      await disableCsd(
        prisma,
        actors.ownerB,
        { expectedActiveCsdId: secondAId },
        custody,
        undefined,
        env,
      )
    ).status,
    "NOT_CONFIGURED",
  );
  await rejectsWith(
    configure(actors.ownerB, csdFor(rfcB), {
      replace: true,
      expectedActiveCsdId: secondAId,
    }),
    "CSD_CONFLICT",
  );
  // A's certificate (RFC of A) cannot be configured for B.
  await rejectsWith(configure(actors.ownerB, csdFor(rfcA)), "CSD_RFC_MISMATCH");
  const own = await configure(actors.ownerB, csdFor(rfcB));
  assert.equal(own.status, "VALID");
  await rejectsWith(
    disableCsd(
      prisma,
      actors.ownerB,
      { expectedActiveCsdId: secondAId },
      custody,
      undefined,
      env,
    ),
    "CSD_NOT_FOUND",
  );
  assert.equal((await state(actors.ownerA)).id, secondAId);
  assert.deepEqual(
    (await listCsdHistory(prisma, "org-b")).map((h) => h.id),
    [own.id],
  );
  // A ciphertext copied from A into B's row never decrypts (AAD binds Organization, CSD,
  // certificate and environment).
  await database.db.query(
    `UPDATE "CsdPrivateKey" AS b SET ciphertext=a.ciphertext, iv=a.iv, "authTag"=a."authTag", "wrappedDek"=a."wrappedDek"
     FROM "CsdPrivateKey" AS a WHERE a."csdCertificateId"=$1 AND b."csdCertificateId"=$2`,
    [secondAId, own.id],
  );
  assert.equal(
    await verifyActiveCsdEnvelope(prisma, "org-b", env),
    "INTEGRITY",
  );
  assert.equal(await verifyActiveCsdEnvelope(prisma, "org-a", env), "OK");
  await disableCsd(
    prisma,
    actors.ownerB,
    { expectedActiveCsdId: own.id! },
    custody,
    undefined,
    env,
  );
});

test("effective state is computed on every read and only VALID can sign", async () => {
  const current = await state(actors.ownerA);
  const validTo = new Date(current.validTo!);
  const validFrom = new Date(current.validFrom!);
  const soon = await state(
    actors.ownerA,
    new Date(validTo.getTime() - 10 * day),
  );
  assert.deepEqual([soon.status, soon.expiresSoon], ["VALID", true]);
  assert.equal((await state(actors.ownerA)).expiresSoon, false);
  const expired = await state(
    actors.ownerA,
    new Date(validTo.getTime() + 1000),
  );
  assert.deepEqual(
    [
      expired.status,
      expired.invalidReason,
      expired.verification?.withinValidity,
      expired.expiresSoon,
    ],
    ["EXPIRED", null, false, false],
  );
  const early = await state(
    actors.ownerA,
    new Date(validFrom.getTime() - 1000),
  );
  assert.deepEqual(
    [early.status, early.invalidReason],
    ["INVALID", "NOT_YET_VALID"],
  );
  // An expired CSD keeps its encrypted key until it is replaced or disabled.
  assert.equal(await verifyActiveCsdEnvelope(prisma, "org-a", env), "OK");
  const withoutKek = { ...env, CSD_KEK_V1: "" };
  const unavailable = await state(actors.ownerA, undefined, withoutKek);
  assert.deepEqual(
    [unavailable.status, unavailable.invalidReason],
    ["INVALID", "KEY_UNAVAILABLE"],
  );
  assert.equal(
    await verifyActiveCsdEnvelope(prisma, "org-a", withoutKek),
    "KEY_UNAVAILABLE",
  );
  // A SANDBOX CSD never serves fiscal PRODUCTION.
  const productionEnv = { ...env, PAC_ENVIRONMENT: "PRODUCTION" };
  const production = await state(
    actors.ownerA,
    undefined,
    productionEnv,
    resolveCustody(productionEnv, authorities),
  );
  assert.deepEqual(
    [production.status, production.invalidReason, production.serviceAvailable],
    ["INVALID", "KEY_UNAVAILABLE", false],
  );
  await sql(`UPDATE "FiscalProfile" SET rfc='XAXX010101000' WHERE id='fp-a'`);
  const changed = await state(actors.ownerA);
  assert.deepEqual(
    [
      changed.status,
      changed.invalidReason,
      changed.verification?.rfcMatchesIssuer,
    ],
    ["INVALID", "RFC_CHANGED", false],
  );
  await sql(`UPDATE "FiscalProfile" SET rfc=$1 WHERE id='fp-a'`, [rfcA]);
  assert.equal((await state(actors.ownerA)).status, "VALID");
  assert.equal((await state(actors.memberA)).canManage, false);
});

test("disable: role, stale id and success destroy the key; idempotent afterwards", async () => {
  await rejectsWith(
    disableCsd(
      prisma,
      actors.memberA,
      { expectedActiveCsdId: secondAId },
      custody,
      undefined,
      env,
    ),
    "CSD_FORBIDDEN",
  );
  await rejectsWith(
    disableCsd(
      prisma,
      actors.ownerA,
      { expectedActiveCsdId: firstAId },
      custody,
      undefined,
      env,
    ),
    "CSD_CONFLICT",
  );
  // Disabling works after expiry and without the KEK: destroying never needs to decrypt.
  const current = await state(actors.ownerA);
  const afterExpiry = new Date(new Date(current.validTo!).getTime() + day);
  const disabled = await disableCsd(
    prisma,
    actors.adminA,
    { expectedActiveCsdId: secondAId },
    custody,
    afterExpiry,
    { ...env, CSD_KEK_V1: "" },
  );
  assert.equal(disabled.status, "NOT_CONFIGURED");
  assert.deepEqual(
    await sql(
      `SELECT "csdCertificateId" FROM "CsdPrivateKey" WHERE "organizationId"='org-a'`,
    ),
    [],
  );
  const [row] = await sql<Record<string, unknown>>(
    `SELECT status,"activeOrganizationId","endedById" FROM "CsdCertificate" WHERE id=$1`,
    [secondAId],
  );
  assert.deepEqual(row, {
    status: "DISABLED",
    activeOrganizationId: null,
    endedById: "admin-a",
  });
  assert.equal(
    (
      await disableCsd(
        prisma,
        actors.ownerA,
        { expectedActiveCsdId: secondAId },
        custody,
        undefined,
        env,
      )
    ).status,
    "NOT_CONFIGURED",
  );
  const events = await sql<{ metadata: unknown; result: string }>(
    `SELECT metadata,result FROM "AuditEvent" WHERE action='csd.disabled' AND "organizationId"='org-a'`,
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].metadata, {
    certificateNumber: (await listCsdHistory(prisma, "org-a"))[0]
      .certificateNumber,
    reason: "USER_REQUEST",
  });
  assert.equal(
    await verifyActiveCsdEnvelope(prisma, "org-a", env),
    "NOT_CONFIGURED",
  );
});

test("concurrency: one ACTIVE CSD per Organization; losers get ALREADY_ACTIVE, CONFLICT or the idempotent result", async () => {
  const contenders = [csdFor(rfcA), csdFor(rfcA), csdFor(rfcA), csdFor(rfcA)];
  const results = await Promise.allSettled(
    contenders.map((material) => configure(actors.ownerR, material)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results)
    if (r.status === "rejected") {
      assert(r.reason instanceof CsdError);
      assert(
        ["CSD_ALREADY_ACTIVE", "CSD_CONFLICT"].includes(r.reason.code),
        r.reason.code,
      );
    }
  const counts = await sql<{ active: number; keys: number }>(
    `SELECT (SELECT COUNT(*)::int FROM "CsdCertificate" WHERE "organizationId"='org-race' AND status='ACTIVE') AS active,
            (SELECT COUNT(*)::int FROM "CsdPrivateKey" WHERE "organizationId"='org-race') AS keys`,
  );
  assert.deepEqual(counts[0], { active: 1, keys: 1 });
  const winner = (await state(actors.ownerR)).id!;
  const material =
    contenders[results.findIndex((r) => r.status === "fulfilled")];
  const same = await Promise.all(
    [0, 1, 2].map(() => configure(actors.ownerR, material)),
  );
  assert(same.every((r) => !r.created && r.id === winner));
  // Concurrent replacements of the same active CSD: exactly one wins.
  const replacements = await Promise.allSettled(
    [csdFor(rfcA), csdFor(rfcA), csdFor(rfcA)].map((m) =>
      configure(actors.ownerR, m, {
        replace: true,
        expectedActiveCsdId: winner,
      }),
    ),
  );
  assert.equal(replacements.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of replacements)
    if (r.status === "rejected")
      assert.equal((r.reason as CsdError).code, "CSD_CONFLICT");
  const after = await sql<{ status: string; n: number }>(
    `SELECT status::text, COUNT(*)::int AS n FROM "CsdCertificate" WHERE "organizationId"='org-race' GROUP BY status ORDER BY status`,
  );
  assert.deepEqual(after, [
    { status: "ACTIVE", n: 1 },
    { status: "REPLACED", n: 1 },
  ]);
  assert.equal(
    (
      await sql<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "CsdPrivateKey" WHERE "organizationId"='org-race'`,
      )
    )[0].n,
    1,
  );
});

test("fail closed: no custody, no profile and no allowlisted CA store nothing", async () => {
  const before = await sql<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "CsdCertificate"`,
  );
  await rejectsWith(
    configure(
      actors.ownerA,
      csdFor(rfcA),
      {},
      { custody: resolveCustody({}, authorities) },
    ),
    "CSD_SERVICE_UNAVAILABLE",
  );
  await rejectsWith(
    configure(
      actors.ownerA,
      csdFor(rfcA),
      {},
      { custody: resolveCustody(env, []) },
    ),
    "CSD_SERVICE_UNAVAILABLE",
  );
  await rejectsWith(
    configure(
      actors.ownerA,
      csdFor(rfcA),
      {},
      {
        custody: resolveCustody(
          {
            ...env,
            PAC_ENVIRONMENT: "PRODUCTION",
            CSD_KEY_PROVIDER_PRODUCTION: "env",
          },
          authorities,
        ),
      },
    ),
    "CSD_SERVICE_UNAVAILABLE",
  );
  await rejectsWith(
    configure(actors.ownerC, csdFor("XAXX010101000")),
    "CSD_ISSUER_PROFILE_REQUIRED",
  );
  const other = syntheticAuthority("OTRA AC SINTETICA");
  await rejectsWith(
    configure(actors.ownerA, syntheticCsd(other, { rfc: rfcA })),
    "CSD_ENVIRONMENT_MISMATCH",
  );
  assert.deepEqual(
    await sql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "CsdCertificate"`),
    before,
  );
  const stages = await sql<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM "AuditEvent" WHERE action='csd.configuration.failed' AND "organizationId" IN ('org-a','org-c') ORDER BY "createdAt" DESC LIMIT 5`,
  );
  assert.deepEqual(stages.map((s) => s.metadata).reverse(), [
    { errorCode: "CSD_SERVICE_UNAVAILABLE", stage: 1 },
    { errorCode: "CSD_SERVICE_UNAVAILABLE", stage: 1 },
    { errorCode: "CSD_SERVICE_UNAVAILABLE", stage: 1 },
    { errorCode: "CSD_ISSUER_PROFILE_REQUIRED", stage: 2 },
    { errorCode: "CSD_ENVIRONMENT_MISMATCH", stage: "8b" },
  ]);
});

test("CSD_SERVICE_UNAVAILABLE never opens, wraps, unwraps or signs; a TEST certificate is never stored as PRODUCTION", async () => {
  const calls: string[] = [];
  const spy = (available: boolean): CsdKeyProvider => ({
    provider: "kms:spy",
    availability: () => {
      calls.push("availability");
      return available
        ? {
            available: true,
            current: { provider: "kms:spy", keyId: "spy", keyVersion: 1 },
          }
        : { available: false, reason: "NOT_CONFIGURED" };
    },
    canUnwrap: () => {
      calls.push("canUnwrap");
      return false;
    },
    wrapDataKey: async () => {
      calls.push("wrap");
      throw new Error("unexpected");
    },
    unwrapDataKey: async () => {
      calls.push("unwrap");
      throw new Error("unexpected");
    },
  });
  const rows = () =>
    sql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "CsdCertificate"`);
  const before = await rows();
  for (const environment of ["SANDBOX", "PRODUCTION"] as const) {
    const material = csdFor(rfcA);
    // A wrong password proves the key is never opened: the answer is
    // SERVICE_UNAVAILABLE, not PASSWORD_INVALID.
    await rejectsWith(
      configureCsd(
        prisma,
        actors.ownerA,
        input(material, { password: material.password + "x" }),
        { environment, provider: spy(false), authorities, available: false },
        undefined,
        env,
      ),
      "CSD_SERVICE_UNAVAILABLE",
    );
  }
  assert.deepEqual(calls, []);
  // Even with a hypothetical available PRODUCTION custody, a certificate demonstrated as
  // TEST (synthetic CA, or the E2E harness CA) is rejected before any key operation.
  await rejectsWith(
    configureCsd(
      prisma,
      actors.ownerA,
      input(csdFor(rfcA)),
      {
        environment: "PRODUCTION",
        provider: spy(true),
        authorities,
        available: true,
      },
      undefined,
      env,
    ),
    "CSD_ENVIRONMENT_MISMATCH",
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(await rows(), before);
  assert.deepEqual(
    await sql(`SELECT id FROM "CsdCertificate" WHERE environment='PRODUCTION'`),
    [],
  );
});

test("hosting never changes the fiscal environment: VERCEL_ENV=production runs SANDBOX with a test CSD", async () => {
  const vercel = resolveCustody(
    { ...env, VERCEL: "1", VERCEL_ENV: "production" },
    authorities,
  );
  assert.equal(vercel.environment, "SANDBOX");
  const result = await configure(
    actors.ownerB,
    csdFor(rfcB),
    {},
    { custody: vercel },
  );
  assert.deepEqual(
    [result.status, result.environment, result.created],
    ["VALID", "SANDBOX", true],
  );
  await disableCsd(
    prisma,
    actors.ownerB,
    { expectedActiveCsdId: result.id! },
    vercel,
    undefined,
    env,
  );
});

test("no password, private key, original .key or envelope leaks into any table, DTO or audit", async () => {
  const tables = await sql<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
  );
  let dump = "";
  for (const { table_name } of tables)
    for (const row of await sql<{ row: string }>(
      `SELECT row_to_json(t)::text AS row FROM "${table_name}" t`,
    ))
      dump += row.row + "\n";
  for (const material of materials) {
    assert(!dump.includes(material.password), "password persisted");
    // The tail of PKCS#8 holds private CRT parameters; the modulus is public (certificate).
    const pkcs8 = material.keyObject.export({ type: "pkcs8", format: "der" });
    assert(
      !dump.includes(pkcs8.subarray(-200, -160).toString("hex")),
      "plain PKCS#8 persisted",
    );
    assert(
      !dump.includes(
        Buffer.from(material.privateKey).subarray(200, 240).toString("hex"),
      ),
      "original .key persisted",
    );
  }
  const allowed: Record<string, string[]> = {
    "csd.configuration.started": ["replace", "reason"],
    "csd.configured": [
      "certificateNumber",
      "environment",
      "validTo",
      "created",
    ],
    "csd.configuration.failed": ["errorCode", "stage"],
    "csd.replaced": ["previousCertificateId", "certificateNumber"],
    "csd.disabled": ["certificateNumber", "reason"],
  };
  const events = await sql<{
    action: string;
    metadata: Record<string, unknown> | null;
    targetType: string;
  }>(
    `SELECT action,metadata,"targetType" FROM "AuditEvent" WHERE action LIKE 'csd.%'`,
  );
  assert(events.length > 10);
  for (const event of events) {
    assert(event.action in allowed, event.action);
    assert.equal(event.targetType, "CsdCertificate");
    for (const key of Object.keys(event.metadata ?? {}))
      assert(allowed[event.action].includes(key), `${event.action}.${key}`);
    assert(
      !/SCA010101AB1|SCB020202CD2|Synthetic|BEGIN|decrypt/i.test(
        JSON.stringify(event.metadata),
      ),
    );
  }
  assert.deepEqual(
    await sql(
      `SELECT action FROM "ActivityLog" WHERE action::text ILIKE '%csd%'`,
    ),
    [],
  );
  const dto = JSON.stringify([
    await state(actors.ownerR),
    await listCsdHistory(prisma, "org-a"),
    await listCsdHistory(prisma, "org-race"),
  ]);
  for (const forbidden of [
    "ciphertext",
    "wrappedDek",
    "authTag",
    "kek",
    "certificateDer",
    "email",
    "@example.test",
  ])
    assert(!dto.includes(forbidden), forbidden);
});
