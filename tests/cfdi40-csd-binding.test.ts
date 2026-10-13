import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { X509Certificate, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { resolveCustody } from "../src/lib/csd/custody";
import { csdCustodyTerms } from "../src/lib/csd/custody-terms";
import { buildPreSealCfdi40 } from "../src/lib/cfdi40/build";
import { loadCfdi40Catalogs } from "../src/lib/cfdi40/catalogs";
import { Cfdi40Error } from "../src/lib/cfdi40/errors";
import {
  configureCsd,
  readActiveCsdCertificateBinding,
  type CsdActor,
} from "../src/services/csd-store";
import { startDatabase } from "../scripts/local-database.mjs";
import { orbitInvoice } from "./fixtures/cfdi40";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.5: NoCertificado/Certificado for the cadena original come from the public
// certificate of the active VALID CSD only. PGlite + Prisma, never Neon; the certificates
// are SYNTHETIC (synthetic CA) and do not prove SAT validity. No private key is opened.

const authority = syntheticAuthority();
const env = {
  CSD_KEY_PROVIDER_SANDBOX: "env",
  CSD_KEK_ID: "orbit-cfdi40-binding",
  CSD_KEK_CURRENT_VERSION: "1",
  CSD_KEK_V1: randomBytes(32).toString("base64"),
};
const custody = resolveCustody(env, [
  new X509Certificate(authority.certificate),
]);
const rfc = "SCA010101AB1";
const owner: CsdActor = {
  organizationId: "org-a",
  userId: "owner-a",
  role: "OWNER",
};
const member: CsdActor = {
  organizationId: "org-a",
  userId: "member-a",
  role: "MEMBER",
};
const other: CsdActor = {
  organizationId: "org-b",
  userId: "owner-b",
  role: "OWNER",
};
const envelopeColumns = [
  "ciphertext",
  "iv",
  "authTag",
  "wrappedDek",
  "privateKey",
];

let database: Awaited<ReturnType<typeof startDatabase>>;
let prisma: PrismaClient;
const material = syntheticCsd(authority, { rfc });
const sql = (query: string, params: unknown[] = []) =>
  database.db.query(query, params);
const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Cfdi40Error) return error.issues[0].code;
    throw error;
  }
  return "NO_ERROR";
};

before(async () => {
  database = await startDatabase();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url, max: 5 }),
  });
  await database.db.exec(`
    INSERT INTO "User" (id,name,email,"updatedAt") VALUES
      ('owner-a','Owner A','owner-a@example.test',NOW()),('member-a','Member A','member-a@example.test',NOW()),
      ('owner-b','Owner B','owner-b@example.test',NOW());
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-a','Org A',NOW()),('org-b','Org B',NOW());
    INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,"confirmedAt","updatedAt") VALUES
      ('fp-a','owner-a','org-a','${rfc}','EMPRESA SINTETICA DE PRUEBAS','601','06600','G03','a@example.test',NOW(),NOW()),
      ('fp-b','owner-b','org-b','SCB020202CD2','EMPRESA SINTETICA B','601','06600','G03','b@example.test',NOW(),NOW());`);
  await configureCsd(
    prisma,
    owner,
    {
      certificate: {
        name: "csd.cer",
        bytes: Buffer.from(material.certificate),
      },
      privateKey: { name: "csd.key", bytes: Buffer.from(material.privateKey) },
      password: material.password,
      custodyTermsVersion: csdCustodyTerms.version,
      accepted: true,
      replace: false,
      expectedActiveCsdId: null,
    },
    custody,
    undefined,
    env,
  );
});
after(async () => {
  await prisma?.$disconnect();
  await database?.close();
});

/** Records every model query with the columns it selects (or ALL). */
function recording(client: PrismaClient) {
  const queries: { model: string; columns: string[] | "ALL" }[] = [];
  const db = new Proxy(client, {
    get(target, model, receiver) {
      const value = Reflect.get(target, model, receiver);
      if (
        typeof model !== "string" ||
        !value ||
        typeof value !== "object" ||
        !("findFirst" in value)
      )
        return typeof value === "function" ? value.bind(target) : value;
      return new Proxy(value, {
        get(delegate, operation) {
          const method = Reflect.get(delegate, operation);
          if (typeof method !== "function") return method;
          return (args?: { select?: Record<string, unknown> }) => {
            queries.push({
              model,
              columns: args?.select ? Object.keys(args.select) : "ALL",
            });
            return method.call(delegate, args);
          };
        },
      });
    },
  });
  return { db, queries };
}

test("the binding comes from the public certificate of the active VALID CSD, never the key", async () => {
  for (const actor of [owner, member]) {
    const { db, queries } = recording(prisma);
    const result = await readActiveCsdCertificateBinding(
      db,
      actor,
      custody,
      undefined,
      env,
    );
    assert.equal(result.environment, "SANDBOX");
    assert.deepEqual(result.binding, {
      noCertificado: material.certificateNumber,
      certificadoBase64: Buffer.from(material.certificate).toString("base64"),
    });
    for (const query of queries) {
      assert.notEqual(
        query.columns,
        "ALL",
        `${query.model} selects every column`,
      );
      for (const column of envelopeColumns)
        assert(!query.columns.includes(column), `${query.model}.${column}`);
    }
    assert(
      queries.some(
        (q) =>
          q.model === "csdCertificate" && q.columns.includes("certificateDer"),
      ),
    );
  }
  // It is directly usable for the pre-seal XML of the same issuer.
  const { binding } = await readActiveCsdCertificateBinding(
    prisma,
    owner,
    custody,
    undefined,
    env,
  );
  const { xml } = buildPreSealCfdi40(
    orbitInvoice([{ quantity: "1", unitPrice: "100" }]),
    {
      issuedAt: new Date(),
      catalogs: await loadCfdi40Catalogs(),
      certificate: binding,
    },
  );
  assert(xml.xml.includes(` NoCertificado="${material.certificateNumber}"`));
});

test("no binding without an active VALID CSD of this Organization and environment", async () => {
  const read = (
    actor: CsdActor,
    options: { now?: Date; c?: typeof custody } = {},
  ) =>
    codeOf(
      readActiveCsdCertificateBinding(
        prisma,
        actor,
        options.c ?? custody,
        options.now,
        env,
      ),
    );
  assert.equal(await read(other), "CSD_NOT_VALID", "another tenant has none");
  assert.equal(
    await read(owner, { now: new Date(Date.now() + 400 * 24 * 3600 * 1000) }),
    "CSD_NOT_VALID",
    "expired",
  );
  assert.equal(
    await read(owner, { c: { ...custody, environment: "PRODUCTION" } }),
    "CSD_NOT_VALID",
    "other fiscal environment",
  );
  await sql(`UPDATE "FiscalProfile" SET rfc='SCB020202CD2' WHERE id='fp-a'`);
  try {
    assert.equal(await read(owner), "CSD_NOT_VALID", "RFC changed");
  } finally {
    await sql(`UPDATE "FiscalProfile" SET rfc='${rfc}' WHERE id='fp-a'`);
  }
  for (const [column, value] of [
    ["certificateSha256", "0".repeat(64)],
    ["certificateNumber", "30001000000000000099"],
    ["serialNumberHex", "00"],
  ]) {
    const [{ original }] = (
      await sql(
        `SELECT "${column}" AS original FROM "CsdCertificate" WHERE "organizationId"='org-a' AND status='ACTIVE'`,
      )
    ).rows as { original: string }[];
    await sql(
      `UPDATE "CsdCertificate" SET "${column}"=$1 WHERE "organizationId"='org-a' AND status='ACTIVE'`,
      [value],
    );
    try {
      assert.equal(await read(owner), "CSD_CERTIFICATE_MISMATCH", column);
    } finally {
      await sql(
        `UPDATE "CsdCertificate" SET "${column}"=$1 WHERE "organizationId"='org-a' AND status='ACTIVE'`,
        [original],
      );
    }
  }
  assert.equal(await read(owner), "NO_ERROR", "restored");
});
