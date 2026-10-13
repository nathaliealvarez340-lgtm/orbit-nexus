import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { X509Certificate, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { resolveCustody, type Custody } from "../src/lib/csd/custody";
import { csdCustodyTerms } from "../src/lib/csd/custody-terms";
import { sealPrivateKey } from "../src/lib/csd/envelope";
import type { CsdKeyProvider } from "../src/lib/csd/key-provider";
import { verifyCfdiSeal } from "../src/lib/csd/signing";
import { buildPreSealCfdi40 } from "../src/lib/cfdi40/build";
import {
  loadCfdi40Catalogs,
  type Cfdi40Catalogs,
} from "../src/lib/cfdi40/catalogs";
import { Cfdi40Error } from "../src/lib/cfdi40/errors";
import {
  compileCfdi40Xslt,
  generateCfdi40OriginalString,
} from "../src/lib/cfdi40/original-string";
import {
  isSealedCfdi40,
  sealedCfdi40XmlProblems,
} from "../src/lib/cfdi40/sealed";
import { cfdi40XsltEngine } from "../src/lib/cfdi40/xslt-engine";
import { loadCfdi40XsltBundle } from "../src/lib/cfdi40/xslt-resources";
import type {
  Cfdi40CertificateBinding,
  PreSealCfdi40Xml,
} from "../src/lib/cfdi40/types";
import {
  configureCsd,
  disableCsd,
  type CsdActor,
} from "../src/services/csd-store";
import {
  sealCfdi40WithActiveCsd,
  signCfdi40OriginalString,
  type SealOptions,
} from "../src/services/csd-signing";
import { startDatabase } from "../scripts/local-database.mjs";
import { issuedAt, validFixtures } from "./fixtures/cfdi40";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.6: the seal with the custodied CSD, end to end against PGlite + Prisma (never
// Neon), with the real configuration flow. SYNTHETIC CSD (synthetic test CA injected as the
// SANDBOX allowlist); nothing here proves SAT validity. PGlite is ONE PostgreSQL session
// shared by every connection, so concurrent transactions run one after another: the
// concurrency tests prove the observable order, while the row lock that gives the same
// order on a real PostgreSQL (FOR SHARE vs the UPDATE of a replacement) is standard
// PostgreSQL behavior, not something PGlite can show.

const authority = syntheticAuthority();
const authorities = [new X509Certificate(authority.certificate)];
const env = {
  CSD_KEY_PROVIDER_SANDBOX: "env",
  CSD_KEK_ID: "orbit-seal-store",
  CSD_KEK_CURRENT_VERSION: "1",
  CSD_KEK_V1: randomBytes(32).toString("base64"),
};
// Deterministic: every configuration, disable and seal runs at this fixed server instant
// (the fixtures' issue instant), inside the CSD's fixed validity; never the system clock.
const FIXED_NOW = issuedAt;
const validity = {
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2036-01-01T00:00:00Z"),
};
const materialA = syntheticCsd(authority, {
  rfc: "SCA010101AB1",
  certificateNumber: "30001000000000000001",
  ...validity,
});
const materialB = syntheticCsd(authority, {
  rfc: "SCA010101AB1",
  certificateNumber: "30001000000000000002",
  ...validity,
});
const materialP = syntheticCsd(authority, {
  rfc: "PEMA800101AB3",
  certificateNumber: "30001000000000000001",
  ...validity,
});
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
const ownerP: CsdActor = {
  organizationId: "org-p",
  userId: "owner-p",
  role: "ADMIN",
};
const ownerB: CsdActor = {
  organizationId: "org-b",
  userId: "owner-b",
  role: "OWNER",
};

// Every custody used here wraps its provider so the test counts each key opening (an
// unwrapped DEK) and can hold a signature in the middle (after the lock, at the key).
let unwraps = 0;
let gate: Promise<void> | null = null;
function countOpenings(provider: CsdKeyProvider): CsdKeyProvider {
  return {
    provider: provider.provider,
    availability: () => provider.availability(),
    canUnwrap: (ref) => provider.canUnwrap(ref),
    wrapDataKey: (dek, aad) => provider.wrapDataKey(dek, aad),
    async unwrapDataKey(ref, wrapped, aad) {
      unwraps++;
      if (gate) await gate;
      return provider.unwrapDataKey(ref, wrapped, aad);
    },
  };
}
const counted = (c: Custody): Custody => ({
  ...c,
  provider: c.provider && countOpenings(c.provider),
});
const base = resolveCustody(env, authorities);
const custody = counted(base);
const counting = custody.provider!;

let database: Awaited<ReturnType<typeof startDatabase>>;
let prisma: PrismaClient;
let catalogs: Cfdi40Catalogs;
const sql = (query: string, params: unknown[] = []) =>
  database.db.query(query, params);
const bindingOf = (material: { certificate: Uint8Array }, number: string) => ({
  noCertificado: number,
  certificadoBase64: Buffer.from(material.certificate).toString("base64"),
});
const bindingA = bindingOf(materialA, "30001000000000000001");
const bindingB = bindingOf(materialB, "30001000000000000002");
const bindingP = bindingOf(materialP, "30001000000000000001");
const upload = (
  material: typeof materialA,
  replace = false,
  expected: string | null = null,
) => ({
  certificate: { name: "csd.cer", bytes: Buffer.from(material.certificate) },
  privateKey: { name: "csd.key", bytes: Buffer.from(material.privateKey) },
  password: material.password,
  custodyTermsVersion: csdCustodyTerms.version,
  accepted: true,
  replace,
  expectedActiveCsdId: expected,
});
const preSeal = (
  name: keyof typeof validFixtures,
  binding: Cfdi40CertificateBinding = bindingA,
): PreSealCfdi40Xml =>
  buildPreSealCfdi40(validFixtures[name].invoice(), {
    issuedAt,
    catalogs,
    certificate: binding,
  }).xml;
const activeId = async (organizationId = "org-a") =>
  (
    (
      await sql(
        `SELECT id FROM "CsdCertificate" WHERE "organizationId"=$1 AND status='ACTIVE'`,
        [organizationId],
      )
    ).rows as { id: string }[]
  )[0]?.id ?? null;
/** Runs a seal; returns the error code (or SEALED) and how many times a key was opened. */
async function attempt(action: () => Promise<unknown>) {
  const before = unwraps;
  let code = "SEALED";
  try {
    await action();
  } catch (error) {
    if (!(error instanceof Cfdi40Error)) throw error;
    assert.equal(error.message, "CFDI40_BUILD_FAILED");
    code = error.issues[0].code;
  }
  return { code, opened: unwraps - before };
}
const seal = (
  actor: CsdActor,
  xml: PreSealCfdi40Xml,
  c: Custody = custody,
  options: SealOptions = {},
  invoiceId: string | null = null,
) =>
  sealCfdi40WithActiveCsd(prisma, actor, { preSeal: xml, invoiceId }, c, {
    env,
    clock: () => FIXED_NOW,
    ...options,
  });

before(async () => {
  catalogs = await loadCfdi40Catalogs();
  database = await startDatabase();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url, max: 5 }),
  });
  await database.db.exec(`
    INSERT INTO "User" (id,name,email,"updatedAt") VALUES
      ('owner-a','Owner A','owner-a@example.test',NOW()),('member-a','Member A','member-a@example.test',NOW()),
      ('owner-p','Owner P','owner-p@example.test',NOW()),('owner-b','Owner B','owner-b@example.test',NOW());
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-a','Org A',NOW()),('org-p','Org P',NOW()),('org-b','Org B',NOW());
    INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,"confirmedAt","updatedAt") VALUES
      ('fp-a','owner-a','org-a','SCA010101AB1','EMPRESA SINTETICA DE PRUEBAS','601','06600','G03','a@example.test',NOW(),NOW()),
      ('fp-p','owner-p','org-p','PEMA800101AB3','PERSONA FISICA SINTETICA','612','06600','G03','p@example.test',NOW(),NOW()),
      ('fp-b','owner-b','org-b','SCB020202CD2','EMPRESA SINTETICA B','601','06600','G03','b@example.test',NOW(),NOW());`);
  await configureCsd(prisma, owner, upload(materialA), custody, FIXED_NOW, env);
  await configureCsd(
    prisma,
    ownerP,
    upload(materialP),
    custody,
    FIXED_NOW,
    env,
  );
  unwraps = 0;
});
after(async () => {
  await prisma?.$disconnect();
  await database?.close();
});

const sellos: string[] = [];

test("ten invoices sealed with the active CSD: verified, one key opening each, audited with ids only", async () => {
  const bundle = await loadCfdi40XsltBundle();
  const stylesheet = compileCfdi40Xslt(cfdi40XsltEngine, bundle);
  const csdA = (await activeId("org-a"))!;
  const csdP = (await activeId("org-p"))!;
  const names = Object.keys(validFixtures) as (keyof typeof validFixtures)[];
  for (const name of names) {
    const personaMoral = name === "ingreso-retenciones-persona-moral";
    const [actor, binding, material] = personaMoral
      ? [ownerP, bindingP, materialP]
      : [owner, bindingA, materialA];
    const xml = preSeal(name, binding);
    const before = unwraps;
    const sealed = await seal(actor, xml, custody, {}, "inv-" + name);
    assert.equal(unwraps - before, 1, `${name}: the key is opened once`);
    assert(isSealedCfdi40(sealed), name);
    assert.deepEqual(
      sealedCfdi40XmlProblems(sealed.xml, stylesheet, binding),
      [],
    );
    const sello = /\sSello="([^"]+)"/.exec(sealed.xml)![1];
    sellos.push(sello);
    const reference = await readFile(
      `tests/fixtures/cfdi40/cadena/orbit/${name}.cadena.txt`,
    );
    assert(
      verifyCfdiSeal(
        new X509Certificate(material.certificate).publicKey,
        reference,
        Buffer.from(sello, "base64"),
      ),
      `${name}: the Sello signs the reference cadena`,
    );
    const [event] = (
      await sql(
        `SELECT action, result, "targetType", "targetId", metadata FROM "AuditEvent" WHERE action='cfdi.sealed' AND "targetId"=$1`,
        ["inv-" + name],
      )
    ).rows as {
      result: string;
      targetType: string;
      metadata: Record<string, unknown>;
    }[];
    assert.equal(event.result, "SUCCESS");
    assert.equal(event.targetType, "StampedInvoice");
    assert.deepEqual(event.metadata, {
      certificateId: personaMoral ? csdP : csdA,
      environment: "SANDBOX",
    });
  }
  // The signing service returns the Sello and metadata only.
  const xml = preSeal("ingreso-ppd");
  const signature = await signCfdi40OriginalString(
    prisma,
    owner,
    {
      preSeal: xml,
      originalString: generateCfdi40OriginalString(xml, {
        engine: cfdi40XsltEngine,
        bundle,
      }),
    },
    custody,
    { env, clock: () => FIXED_NOW },
  );
  assert.deepEqual(Object.keys(signature).sort(), [
    "algorithm",
    "csdCertificateId",
    "environment",
    "noCertificado",
    "sello",
  ]);
  assert.equal(signature.algorithm, "RSA-SHA256 PKCS#1 v1.5");
  assert(Object.isFrozen(signature));
  // The hosting environment is not the fiscal authority: a Vercel production deployment
  // runs fiscal SANDBOX with a demonstrated test CSD (FASE5C3 §G.1).
  const onVercel = resolveCustody(
    { ...env, VERCEL_ENV: "production" },
    authorities,
  );
  assert.equal(onVercel.environment, "SANDBOX");
  assert(
    isSealedCfdi40(await seal(owner, preSeal("ingreso-exento"), onVercel)),
  );
});

test("nothing opens the private key unless every condition holds; each refusal has a stable code", async () => {
  const bundle = await loadCfdi40XsltBundle();
  const cadenaOf = (xml: PreSealCfdi40Xml) =>
    generateCfdi40OriginalString(xml, { engine: cfdi40XsltEngine, bundle });
  const xml = preSeal("ingreso-pue-iva16");
  const sign =
    (request: Parameters<typeof signCfdi40OriginalString>[2], actor = owner) =>
    () =>
      signCfdi40OriginalString(prisma, actor, request, custody, {
        env,
        clock: () => FIXED_NOW,
      });
  const id = (await activeId())!;
  const expectRefused = async (
    label: string,
    action: () => Promise<unknown>,
    code: string,
    opened = 0,
  ) => assert.deepEqual(await attempt(action), { code, opened }, label);

  await expectRefused("member", () => seal(member, xml), "CSD_FORBIDDEN");
  await expectRefused(
    "look-alike pre-seal",
    sign({
      preSeal: { ...xml } as PreSealCfdi40Xml,
      originalString: cadenaOf(xml),
    }),
    "PRE_SEAL_CFDI_REQUIRED",
  );
  await expectRefused(
    "cadena of another pre-seal",
    sign({ preSeal: xml, originalString: cadenaOf(preSeal("ingreso-ppd")) }),
    "ORIGINAL_STRING_INVALID",
  );
  await expectRefused(
    "Organization without CSD",
    () => seal(ownerB, xml),
    "CSD_NOT_CONFIGURED",
  );
  // Custody: none configured, and fiscal PRODUCTION in every form (env provider, a KMS that
  // does not exist, and custody objects forged to look available).
  await expectRefused(
    "no custody",
    () => seal(owner, xml, counted(resolveCustody({}, authorities))),
    "CSD_SERVICE_UNAVAILABLE",
  );
  for (const provider of ["env", "kms:aws-kms"])
    await expectRefused(
      `PRODUCTION with ${provider}`,
      () =>
        seal(
          owner,
          xml,
          counted(
            resolveCustody(
              {
                ...env,
                PAC_ENVIRONMENT: "PRODUCTION",
                CSD_KEY_PROVIDER_PRODUCTION: provider,
              },
              authorities,
            ),
          ),
        ),
      "CSD_SERVICE_UNAVAILABLE",
    );
  const fakeKms: CsdKeyProvider = { ...counting, provider: "kms:fake" };
  for (const provider of [counting, fakeKms])
    await expectRefused(
      `forged PRODUCTION custody (${provider.provider})`,
      () =>
        seal(owner, xml, {
          environment: "PRODUCTION",
          provider,
          authorities,
          available: true,
        }),
      "CSD_SERVICE_UNAVAILABLE",
    );
  // Environment: a stored PRODUCTION CSD under SANDBOX custody, and a certificate not issued
  // by an allowlisted test CA (§M.0).
  await sql(
    `UPDATE "CsdCertificate" SET environment='PRODUCTION' WHERE id=$1`,
    [id],
  );
  try {
    await expectRefused(
      "CSD of another environment",
      () => seal(owner, xml),
      "CSD_ENVIRONMENT_MISMATCH",
    );
  } finally {
    await sql(`UPDATE "CsdCertificate" SET environment='SANDBOX' WHERE id=$1`, [
      id,
    ]);
  }
  const otherCa = syntheticAuthority("AC SINTETICA DISTINTA");
  await expectRefused(
    "not a demonstrated test certificate",
    () =>
      seal(owner, xml, {
        ...custody,
        authorities: [new X509Certificate(otherCa.certificate)],
      }),
    "CSD_ENVIRONMENT_MISMATCH",
  );
  // Validity: after validTo, before validFrom, and expiring between the lock and the key.
  await expectRefused(
    "expired",
    () =>
      seal(owner, xml, custody, {
        clock: () => new Date("2036-02-01T00:00:00Z"),
      }),
    "CSD_EXPIRED",
  );
  await expectRefused(
    "not yet valid",
    () =>
      seal(owner, xml, custody, {
        clock: () => new Date("2025-12-01T00:00:00Z"),
      }),
    "CSD_NOT_VALID",
  );
  let calls = 0;
  await expectRefused(
    "expires right before the key is opened",
    () =>
      seal(owner, xml, custody, {
        clock: () =>
          calls++ === 0 ? FIXED_NOW : new Date("2036-02-01T00:00:00Z"),
      }),
    "CSD_EXPIRED",
  );
  assert.equal(
    calls,
    2,
    "validity is checked under the lock and again before opening",
  );
  // RFC: the Fiscal Profile changed, and a CFDI of another issuer.
  await sql(`UPDATE "FiscalProfile" SET rfc='SCB020202CD2' WHERE id='fp-a'`);
  try {
    await expectRefused(
      "Fiscal Profile RFC changed",
      () => seal(owner, xml),
      "CSD_NOT_VALID",
    );
  } finally {
    await sql(`UPDATE "FiscalProfile" SET rfc='SCA010101AB1' WHERE id='fp-a'`);
  }
  await expectRefused(
    "issuer of the CFDI is not the CSD's RFC",
    () => seal(owner, preSeal("ingreso-retenciones-persona-moral", bindingA)),
    "CSD_RFC_MISMATCH",
  );
  // Certificate: the XML carries another certificate, or the record no longer matches.
  await expectRefused(
    "pre-seal with another certificate",
    () => seal(owner, preSeal("ingreso-pue-iva16", bindingB)),
    "CSD_CERTIFICATE_MISMATCH",
  );
  const [{ sha }] = (
    await sql(
      `SELECT "certificateSha256" AS sha FROM "CsdCertificate" WHERE id=$1`,
      [id],
    )
  ).rows as { sha: string }[];
  await sql(`UPDATE "CsdCertificate" SET "certificateSha256"=$1 WHERE id=$2`, [
    "0".repeat(64),
    id,
  ]);
  try {
    await expectRefused(
      "record tampered",
      () => seal(owner, xml),
      "CSD_CERTIFICATE_MISMATCH",
    );
  } finally {
    await sql(
      `UPDATE "CsdCertificate" SET "certificateSha256"=$1 WHERE id=$2`,
      [sha, id],
    );
  }
  // Key: KEK version no longer available (rotation without rewrap).
  const rotated = {
    ...env,
    CSD_KEK_CURRENT_VERSION: "2",
    CSD_KEK_V1: "",
    CSD_KEK_V2: randomBytes(32).toString("base64"),
  };
  await expectRefused(
    "KEK version unavailable",
    () =>
      seal(owner, xml, counted(resolveCustody(rotated, authorities)), {
        env: rotated,
      }),
    "CSD_KEY_UNAVAILABLE",
  );
  // Only these two reach the key: a corrupted envelope fails its GCM tag, and an envelope
  // holding a key of another certificate is refused before signing.
  await sql(
    `UPDATE "CsdPrivateKey" SET ciphertext=set_byte(ciphertext,0,get_byte(ciphertext,0) # 1) WHERE "csdCertificateId"=$1`,
    [id],
  );
  try {
    await expectRefused(
      "envelope corrupted",
      () => seal(owner, xml),
      "CSD_KEY_INTEGRITY_FAILED",
      1,
    );
  } finally {
    await sql(
      `UPDATE "CsdPrivateKey" SET ciphertext=set_byte(ciphertext,0,get_byte(ciphertext,0) # 1) WHERE "csdCertificateId"=$1`,
      [id],
    );
  }
  const [original] = (
    await sql(
      `SELECT ciphertext, iv, "authTag", "wrappedDek" FROM "CsdPrivateKey" WHERE "csdCertificateId"=$1`,
      [id],
    )
  ).rows as Record<string, Uint8Array>[];
  const foreign = await sealPrivateKey(
    base.provider!,
    {
      organizationId: "org-a",
      csdCertificateId: id,
      certificateSha256: sha,
      environment: "SANDBOX",
    },
    materialB.keyObject.export({ type: "pkcs8", format: "der" }) as Buffer,
  );
  const setEnvelope = (e: {
    ciphertext: Uint8Array;
    iv: Uint8Array;
    authTag: Uint8Array;
    wrappedDek: Uint8Array;
  }) =>
    sql(
      `UPDATE "CsdPrivateKey" SET ciphertext=$1, iv=$2, "authTag"=$3, "wrappedDek"=$4 WHERE "csdCertificateId"=$5`,
      [e.ciphertext, e.iv, e.authTag, e.wrappedDek, id],
    );
  await setEnvelope(foreign);
  try {
    await expectRefused(
      "key of another certificate",
      () => seal(owner, xml),
      "CSD_KEY_MISMATCH",
      1,
    );
  } finally {
    await setEnvelope(original as never);
  }
  // Everything restored: it seals again.
  assert.deepEqual(await attempt(() => seal(owner, xml)), {
    code: "SEALED",
    opened: 1,
  });

  // Every refusal of the orchestrator left a FAILURE/DENIED event with its code only.
  const failures = (
    await sql(
      `SELECT result, metadata FROM "AuditEvent" WHERE action='cfdi.seal.failed'`,
    )
  ).rows as { result: string; metadata: Record<string, unknown> }[];
  const codes = failures.map((f) => f.metadata.errorCode);
  for (const code of [
    "CSD_FORBIDDEN",
    "CSD_NOT_CONFIGURED",
    "CSD_SERVICE_UNAVAILABLE",
    "CSD_ENVIRONMENT_MISMATCH",
    "CSD_EXPIRED",
    "CSD_NOT_VALID",
    "CSD_RFC_MISMATCH",
    "CSD_CERTIFICATE_MISMATCH",
    "CSD_KEY_UNAVAILABLE",
    "CSD_KEY_INTEGRITY_FAILED",
    "CSD_KEY_MISMATCH",
  ])
    assert(codes.includes(code), code);
  assert.equal(
    failures.find((f) => f.metadata.errorCode === "CSD_FORBIDDEN")!.result,
    "DENIED",
  );
  for (const { metadata } of failures)
    for (const key of Object.keys(metadata))
      assert(["errorCode", "certificateId", "environment"].includes(key), key);
});

test("no Sello, cadena, XML, certificate or key material reaches the audit trail, the activity log or an error", async () => {
  const audit = JSON.stringify(
    (await sql(`SELECT * FROM "AuditEvent"`)).rows,
    (_key, value) => (value instanceof Uint8Array ? "[bytes]" : value),
  );
  assert(sellos.length >= 10);
  for (const sello of sellos) assert(!audit.includes(sello.slice(0, 40)));
  for (const fragment of [
    "||4.0|",
    "<cfdi",
    bindingA.certificadoBase64.slice(0, 40),
    "PRIVATE KEY",
    "ciphertext",
    "wrappedDek",
    materialA.password,
  ])
    assert(!audit.includes(fragment), fragment);
  const activity = (
    await sql(
      `SELECT action FROM "ActivityLog" WHERE action ILIKE '%seal%' OR action ILIKE '%cfdi%'`,
    )
  ).rows;
  assert.deepEqual(activity, [], "seals are audited in AuditEvent only");
  // A coded error serializes without the cadena, the XML or the certificate.
  try {
    await seal(owner, preSeal("ingreso-pue-iva16", bindingB));
    assert.fail("must not seal");
  } catch (error) {
    const text = JSON.stringify(error) + String(error);
    assert.match(text, /CSD_CERTIFICATE_MISMATCH/);
    for (const fragment of [
      "||4.0|",
      "<cfdi",
      bindingB.certificadoBase64.slice(0, 40),
    ])
      assert(!text.includes(fragment), fragment);
  }
});

/** Starts a seal and waits until it holds the lock and reaches the key opening. */
async function sealHeldAtKey(xml: PreSealCfdi40Xml, invoiceId: string) {
  let release!: () => void;
  gate = new Promise<void>((resolve) => (release = resolve));
  const reached = unwraps;
  const sealing = seal(owner, xml, custody, {}, invoiceId);
  while (unwraps === reached) await new Promise((r) => setImmediate(r));
  return { sealing, release };
}

test("concurrency: two seals of the same CFDI give the same bytes; a replacement waits for an ongoing seal", async () => {
  // Same CFDI twice at once: same deterministic Sello, one key opening each, nothing stored.
  const xml = preSeal("ingreso-descuento");
  const before = unwraps;
  const [first, second] = await Promise.all([
    seal(owner, xml, custody, {}, "inv-twice"),
    seal(owner, xml, custody, {}, "inv-twice"),
  ]);
  assert.equal(first.xml, second.xml);
  assert.equal(unwraps - before, 2);

  // A replacement requested while a seal holds the lock completes after it.
  const idA = (await activeId())!;
  const { sealing, release } = await sealHeldAtKey(xml, "inv-race");
  const order: string[] = [];
  const sealed = sealing.then((value) => (order.push("sealed"), value));
  const replaced = configureCsd(
    prisma,
    owner,
    upload(materialB, true, idA),
    custody,
    FIXED_NOW,
    env,
  ).then((value) => (order.push("replaced"), value));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(order, [], "the replacement waits");
  release();
  gate = null;
  const [result] = await Promise.all([sealed, replaced]);
  assert.deepEqual(order, ["sealed", "replaced"]);
  assert(
    verifyCfdiSeal(
      new X509Certificate(materialA.certificate).publicKey,
      await readFile(
        "tests/fixtures/cfdi40/cadena/orbit/ingreso-descuento.cadena.txt",
      ),
      Buffer.from(/\sSello="([^"]+)"/.exec(result.xml)![1], "base64"),
    ),
    "the ongoing seal used the CSD that was active when it started",
  );
  // After the replacement, the old pre-seal XML is refused and must be rebuilt.
  assert.equal(
    (await attempt(() => seal(owner, xml))).code,
    "CSD_CERTIFICATE_MISMATCH",
  );
  assert(
    isSealedCfdi40(await seal(owner, preSeal("ingreso-descuento", bindingB))),
  );

  // A disable requested while a seal holds the lock also completes after it; then nothing
  // can be sealed.
  const idB = (await activeId())!;
  const held = await sealHeldAtKey(
    preSeal("ingreso-ppd", bindingB),
    "inv-disable",
  );
  const sequence: string[] = [];
  const done = held.sealing.then(() => sequence.push("sealed"));
  const disabled = disableCsd(
    prisma,
    owner,
    { expectedActiveCsdId: idB },
    custody,
    FIXED_NOW,
    env,
  ).then(() => sequence.push("disabled"));
  await new Promise((r) => setTimeout(r, 50));
  held.release();
  gate = null;
  await Promise.all([done, disabled]);
  assert.deepEqual(sequence, ["sealed", "disabled"]);
  assert.deepEqual(
    await attempt(() => seal(owner, preSeal("ingreso-ppd", bindingB))),
    {
      code: "CSD_NOT_CONFIGURED",
      opened: 0,
    },
  );
});
