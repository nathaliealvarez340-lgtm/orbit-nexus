import assert from "node:assert/strict";
import { before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import cfdi40Manifest from "../src/lib/sat/cfdi40/manifest.json";
import {
  buildUnsignedCfdi40,
  checkCfdi40Content,
} from "../src/lib/cfdi40/build";
import {
  loadCfdi40Catalogs,
  type Cfdi40Catalogs,
} from "../src/lib/cfdi40/catalogs";
import { Cfdi40Error, type Cfdi40Issue } from "../src/lib/cfdi40/errors";
import { localIssueDateTime } from "../src/lib/cfdi40/issue-date";
import { cfdi40ReadinessIssues } from "../src/lib/cfdi40/readiness";
import {
  cfdi40ResourceDirectory,
  cfdi40ResourcePath,
  readCfdi40Resource,
} from "../src/lib/cfdi40/resources";
import { cfdi40SchemaValidator } from "../src/lib/cfdi40/schema";
import {
  assertSealedCfdi40,
  isSealedCfdi40,
  pacSubmission,
  sealAttributeProblems,
  type Cfdi40PacAdapter,
  type SealAttributeProblem,
} from "../src/lib/cfdi40/sealed";
import type {
  OrbitInvoiceForCfdi,
  SealedCfdi40Xml,
} from "../src/lib/cfdi40/types";
import { buildValidationResult } from "../src/lib/invoice-rules";
import {
  issuedAt,
  issuer,
  orbitInvoice,
  receivers,
  type ConceptSpec,
} from "./fixtures/cfdi40";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.4 final hardening: READY = CFDI content gate, inherited defaults, no default time
// zone, unsigned/sealed separation and SAT resource integrity. Synthetic data only; the
// synthetic certificates DO NOT PROVE SAT VALIDITY.

let catalogs: Cfdi40Catalogs;
before(async () => {
  catalogs = await loadCfdi40Catalogs();
});
const one = (
  spec: Partial<ConceptSpec> = {},
  overrides: Partial<OrbitInvoiceForCfdi> = {},
) => orbitInvoice([{ quantity: "1", unitPrice: "1000", ...spec }], overrides);
const content = (invoice: OrbitInvoiceForCfdi, at: Date = issuedAt) =>
  checkCfdi40Content(invoice, { at, catalogs });
function emission(
  invoice: OrbitInvoiceForCfdi,
  at: Date = issuedAt,
): readonly Cfdi40Issue[] {
  try {
    buildUnsignedCfdi40(invoice, { issuedAt: at, catalogs });
    return [];
  } catch (error) {
    if (error instanceof Cfdi40Error) return error.issues;
    throw error;
  }
}
const codes = (issues: readonly { code: string }[]) =>
  issues.map((i) => i.code);
const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");

// --- 1. READY vs CFDI builder ---------------------------------------------------------------

test("READY gate runs the builder's own rules; only status and draft date wait for emission", () => {
  assert.deepEqual(content(one()), []);
  const draft = one({}, { status: "DRAFT", invoiceDate: "2026-10-11" });
  assert.deepEqual(
    content(draft),
    [],
    "content is emittable while still a DRAFT",
  );
  assert.deepEqual(codes(emission(draft)), ["INVOICE_NOT_READY"]);
  assert.deepEqual(codes(emission(one({}, { invoiceDate: "2026-10-11" }))), [
    "ISSUE_DATE_DIFFERS_FROM_DRAFT",
  ]);
  // Cases Invoice Studio's own rules let through (warnings or curated catalogs) and the
  // CFDI 4.0 contract rejects: they now block READY.
  const blocked: [OrbitInvoiceForCfdi, string][] = [
    [one({ productCode: "01010101" }), "PRODUCT_CODE_GENERIC"],
    [one({ vatRate: "0.08" }), "VAT_BORDER_RATE_UNSUPPORTED"],
    [one({ productCode: "15101505" }), "PRODUCT_COMPLEMENT_UNSUPPORTED"],
    [one({ description: "Servicio | mensual" }), "TEXT_PIPE_NOT_ALLOWED"],
    [one({}, { exportCode: "03" }), "EXPORT_UNSUPPORTED"],
    [
      one(
        {},
        {
          receiverSnapshot: {
            ...receivers.company,
            rfc: "XEXX010101000",
            fiscalRegime: "616",
          },
        },
      ),
      "FOREIGN_RECEIVER_UNSUPPORTED",
    ],
    [
      one({}, { issuerSnapshot: { ...issuer, postalCode: "32000" } }),
      "ISSUE_TIME_ZONE_UNRESOLVED",
    ],
  ];
  for (const [invoice, code] of blocked) {
    assert(codes(content(invoice)).includes(code), code);
    assert(codes(emission(invoice)).includes(code), code);
  }
});

test("CFDI issues use Invoice Studio's validation contract and block READY", () => {
  const invoice = orbitInvoice([
    { quantity: "1", unitPrice: "1000" },
    { quantity: "1", unitPrice: "10", productCode: "01010101" },
  ]);
  const mapped = cfdi40ReadinessIssues(content(invoice));
  assert.deepEqual(
    mapped.map((i) => [i.code, i.severity, i.section, i.field, i.conceptIndex]),
    [["CFDI_PRODUCT_CODE_GENERIC", "ERROR", "concepts", "productCode", 1]],
  );
  const place = cfdi40ReadinessIssues(
    content(one({}, { issuerSnapshot: { ...issuer, postalCode: "00001" } })),
  );
  assert.deepEqual(
    place.map((i) => [i.code, i.section, i.field]),
    [["CFDI_PLACE_OF_ISSUE_UNKNOWN", "issuer", "postalCode"]],
  );
  assert.match(place[0].message, /\(CFDI40126\)$/);
  const zone = cfdi40ReadinessIssues(
    content(one({}, { issuerSnapshot: { ...issuer, postalCode: "32000" } })),
  );
  assert.deepEqual(
    zone.map((i) => [i.code, i.section, i.field]),
    [["CFDI_ISSUE_TIME_ZONE_UNRESOLVED", "issuer", undefined]],
  );
  for (const issues of [mapped, place, zone]) {
    const result = buildValidationResult(issues, "I");
    assert.equal(result.valid, false);
    assert.equal(result.canMarkReady, false);
  }
});

// --- 2. Inherited fiscal defaults -----------------------------------------------------------

test("an inherited default never becomes a CFDI value silently", () => {
  // Never saved by the Fase 5 rules: blocked whatever its values, at READY and emission.
  const legacy = one(
    { productCode: "01010101", unitCode: "ACT" },
    { legacyRecord: true },
  );
  assert.deepEqual(codes(content(legacy)), ["LEGACY_RECORD_REVIEW_REQUIRED"]);
  assert(codes(emission(legacy)).includes("LEGACY_RECORD_REVIEW_REQUIRED"));
  // Even when its defaults (02, TASA, 01) happen to be valid, the review is required.
  assert.deepEqual(codes(content(one({}, { legacyRecord: true }))), [
    "LEGACY_RECORD_REVIEW_REQUIRED",
  ]);
  // After the review, the Fase 3 default product code still blocks until replaced.
  assert(
    codes(content(one({ productCode: "01010101", unitCode: "ACT" }))).includes(
      "PRODUCT_CODE_GENERIC",
    ),
  );
  // ACT with a specific product code is a legitimate explicit choice.
  assert.deepEqual(content(one({ unitCode: "ACT" })), []);
  // Unselected values stay unselected: nothing is assumed.
  assert.deepEqual(codes(content(one({ taxObject: "", vatRate: null }))), [
    "TAX_OBJECT_MISSING",
  ]);
  assert.deepEqual(codes(content(one({}, { exportCode: "" }))), [
    "EXPORT_CODE_MISSING",
  ]);
  // TASA preselected without an explicit rate never produces an IVA amount.
  assert.deepEqual(codes(content(one({ vatRate: null }))), [
    "CONCEPT_VAT_MISSING",
  ]);
});

// --- 3. Time zone -------------------------------------------------------------------------

test("Fecha never falls back to a default postal code or time zone", async () => {
  const unknown = one(
    {},
    { issuerSnapshot: { ...issuer, postalCode: "00001" } },
  );
  for (const issues of [content(unknown), emission(unknown)]) {
    assert.deepEqual(codes(issues), ["PLACE_OF_ISSUE_UNKNOWN"]);
    assert.equal(issues[0].rule, "CFDI40126");
    assert.match(issues[0].message, /Perfil Fiscal/);
    assert.match(issues[0].message, /zona horaria por defecto/);
  }
  const frontier = one(
    {},
    { issuerSnapshot: { ...issuer, postalCode: "32000" } },
  );
  for (const issues of [content(frontier), emission(frontier)]) {
    assert.deepEqual(codes(issues), ["ISSUE_TIME_ZONE_UNRESOLVED"]);
    assert.match(issues[0].message, /Perfil Fiscal/);
    assert.match(issues[0].message, /zona horaria por defecto/);
  }
  assert.deepEqual(
    codes(content(one({}, { issuerSnapshot: { ...issuer, postalCode: "" } }))),
    ["ISSUER_DATA_MISSING"],
  );
  // Unusable published data is unresolved, never guessed.
  const centro = catalogs.postalCode("06600")!.timeZone;
  const noroeste = catalogs.postalCode("21000")!.timeZone;
  for (const zone of [
    { ...centro, winter: { ...centro.winter, utcOffset: "" } },
    { ...centro, winter: { ...centro.winter, utcOffset: "-6:00" } },
    { ...centro, summer: { ...centro.summer, utcOffset: "-5" } },
    { ...noroeste, winter: { ...noroeste.winter, month: "" } },
    { ...noroeste, summer: { ...noroeste.summer, day: "Quinto domingo" } },
    { ...noroeste, summer: { ...noroeste.summer, utcOffset: "-9" } },
  ])
    assert.equal(localIssueDateTime(issuedAt, zone), null);
  // No hard-coded zone anywhere in the CFDI module.
  for (const file of await readdir("src/lib/cfdi40")) {
    const text = await readFile(join("src/lib/cfdi40", file), "utf8");
    assert(
      !/Mexico_City|America\/|Etc\/GMT|toLocale(Date|Time)?String|getTimezoneOffset/.test(
        text,
      ),
      file,
    );
  }
});

// --- 4. Unsigned vs sealed ------------------------------------------------------------------

test("only a CFDI sealed and registered by ORBIT can reach the XSD gate or a PAC", async () => {
  const { xml: unsigned } = buildUnsignedCfdi40(one(), { issuedAt, catalogs });

  // Compile time: these lines fail `npm run typecheck` if the guarantees disappear.
  // @ts-expect-error An unsigned XML is not a sealed CFDI.
  const asSealed: SealedCfdi40Xml = unsigned;
  // @ts-expect-error No object literal can carry the sealed brand.
  const literal: SealedCfdi40Xml = {
    stage: "SEALED",
    xml: unsigned.xml,
    bytes: unsigned.bytes,
    sha256: unsigned.sha256,
    certificate: { noCertificado: "", certificadoBase64: "" },
  };
  const adapter: Cfdi40PacAdapter = { submit: async () => undefined };
  // @ts-expect-error A PAC adapter accepts only a sealed submission.
  await adapter.submit({ cfdi: unsigned });
  const gate = await cfdi40SchemaValidator.validate(
    // @ts-expect-error The XSD gate accepts only a sealed CFDI.
    unsigned,
  );
  assert.equal(gate.status, "REJECTED");
  assert.equal(isSealedCfdi40(asSealed), false);
  assert.equal(isSealedCfdi40(literal), false);

  // Structural checks of the seal attributes, with a synthetic CSD-like certificate.
  const authority = syntheticAuthority();
  const csd = syntheticCsd(authority);
  const certificado = Buffer.from(csd.certificate).toString("base64");
  const sello = sign(
    "sha256",
    Buffer.from(unsigned.xml),
    csd.keyObject,
  ).toString("base64");
  const binding = {
    noCertificado: csd.certificateNumber,
    certificadoBase64: certificado,
  };
  const sealed = (attributes: Record<string, string> = {}) =>
    unsigned.xml.replace(
      "<cfdi:Comprobante ",
      "<cfdi:Comprobante " +
        Object.entries({
          NoCertificado: csd.certificateNumber,
          Certificado: certificado,
          Sello: sello,
          ...attributes,
        })
          .map(([name, value]) => `${name}="${value}" `)
          .join(""),
    );
  assert.deepEqual(sealAttributeProblems(sealed(), binding), []);
  assert.deepEqual(sealAttributeProblems(unsigned.xml), [
    "SELLO_MISSING",
    "CERTIFICADO_MISSING",
    "NO_CERTIFICADO_INVALID",
  ]);
  const placeholders: [Record<string, string>, SealAttributeProblem][] = [
    [{ Sello: "" }, "SELLO_MISSING"],
    [{ Sello: "PLACEHOLDER" }, "SELLO_INVALID"],
    [{ Sello: "SELLO" }, "SELLO_INVALID"],
    [{ Sello: Buffer.alloc(256).toString("base64") }, "SELLO_INVALID"],
    [{ Sello: Buffer.alloc(256, 0xff).toString("base64") }, "SELLO_INVALID"],
    [{ Sello: sello.slice(0, 76) + " " + sello.slice(76) }, "SELLO_INVALID"],
    [{ Sello: randomBytes(128).toString("base64") }, "SELLO_LENGTH_MISMATCH"],
    [{ Certificado: "" }, "CERTIFICADO_MISSING"],
    [
      { Certificado: Buffer.from("PLACEHOLDER").toString("base64") },
      "CERTIFICADO_INVALID",
    ],
    [
      { Certificado: randomBytes(900).toString("base64") },
      "CERTIFICADO_INVALID",
    ],
    [
      { Certificado: Buffer.from(authority.certificate).toString("base64") },
      "CERTIFICADO_INVALID",
    ],
    [{ NoCertificado: "" }, "NO_CERTIFICADO_INVALID"],
    [{ NoCertificado: "1234" }, "NO_CERTIFICADO_INVALID"],
    [{ NoCertificado: "0".repeat(20) }, "NO_CERTIFICADO_MISMATCH"],
    [
      {
        NoCertificado: csd.certificateNumber.replace(/.$/, (d) =>
          String((Number(d) + 1) % 10),
        ),
      },
      "NO_CERTIFICADO_MISMATCH",
    ],
  ];
  for (const [attributes, problem] of placeholders)
    assert(
      sealAttributeProblems(sealed(attributes)).includes(problem),
      `${Object.keys(attributes)[0]} -> ${problem}`,
    );
  assert.deepEqual(
    sealAttributeProblems(sealed(), {
      ...binding,
      noCertificado: "0".repeat(20),
    }),
    ["BINDING_MISMATCH"],
  );

  // Runtime: even a well-formed forgery is rejected, because ORBIT did not seal it.
  const bytes = new TextEncoder().encode(sealed());
  const forged = {
    stage: "SEALED",
    xml: sealed(),
    bytes,
    sha256: sha256(bytes),
    certificate: binding,
  } as unknown as SealedCfdi40Xml;
  const notSealed = (error: unknown) =>
    error instanceof Cfdi40Error &&
    error.issues[0].code === "SEALED_CFDI_REQUIRED" &&
    error.issues[0].category === "SEAL";
  assert.equal(isSealedCfdi40(forged), false);
  assert.throws(() => assertSealedCfdi40(forged), notSealed);
  assert.throws(() => pacSubmission(forged), notSealed);
  assert.throws(() => pacSubmission(unsigned), notSealed);
  assert.deepEqual(await cfdi40SchemaValidator.validate(forged), {
    status: "REJECTED",
    reason: "NOT_SEALED_BY_ORBIT",
  });

  // Nothing in this phase registers or produces a sealed CFDI.
  const source = await readFile("src/lib/cfdi40/sealed.ts", "utf8");
  assert(!/registry\.add\(/.test(source));
  for (const file of await readdir("src/lib/cfdi40"))
    if (!["types.ts", "sealed.ts"].includes(file))
      assert(
        !/"SEALED"/.test(await readFile(join("src/lib/cfdi40", file), "utf8")),
        file,
      );
  assert(!/\s(Sello|NoCertificado|Certificado)=/.test(unsigned.xml));
});

// --- 5. SAT resource integrity --------------------------------------------------------------

test("SAT resources: byte-exact manifest, closed directory, contained paths, Git binary", async () => {
  const stored = cfdi40Manifest.resources.flatMap((r) =>
    typeof r.stored === "string" ? [{ ...r, stored: r.stored }] : [],
  );
  const files = (
    await readdir(cfdi40ResourceDirectory, {
      recursive: true,
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(cfdi40ResourceDirectory, join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/"),
    );
  assert.deepEqual(
    files.sort(),
    stored.map((r) => r.name).sort(),
    "resources/sat/cfdi40 holds exactly the manifest's files",
  );
  const root = process.cwd();
  for (const r of stored) {
    const bytes = await readFile(r.stored);
    assert.equal(bytes.length, r.bytes, r.name);
    assert.equal(sha256(bytes), r.sha256, r.name);
    assert.equal(
      cfdi40ResourcePath(r.name, r.stored, root),
      path.resolve(root, r.stored),
    );
    const attributes = spawnSync(
      "git",
      ["check-attr", "binary", "text", "--", r.stored],
      { encoding: "utf8" },
    ).stdout;
    assert.match(attributes, /: binary: set/, r.name);
    assert.match(attributes, /: text: unset/, r.name);
  }
  for (const bad of [
    "../cfdv40.xsd",
    "resources/sat/cfdi40/../catcfdi/cfdv40.xsd",
    "resources/sat/cfdi40/../../../cfdv40.xsd",
    "resources/sat/cfdv40.xsd",
    "resources/sat/cfdi40/nested/cfdv40.xsd",
    "resources/sat/cfdi40/tdCFDI.xsd",
    "resources\\sat\\cfdi40\\cfdv40.xsd",
    path.resolve(root, "resources/sat/cfdi40/cfdv40.xsd"),
  ])
    assert.equal(cfdi40ResourcePath("cfdv40.xsd", bad, root), null, bad);

  // A line-ending conversion is a modification: the hash check rejects it.
  const copy = await mkdtemp(join(tmpdir(), "orbit-cfdi40-eol-"));
  await mkdir(join(copy, cfdi40ResourceDirectory), { recursive: true });
  const original = await readFile("resources/sat/cfdi40/cfdv40.xsd");
  await writeFile(
    join(copy, "resources/sat/cfdi40/cfdv40.xsd"),
    original.toString("latin1").replace(/\r\n/g, "\n"),
    "latin1",
  );
  await assert.rejects(
    readCfdi40Resource("cfdv40.xsd", copy),
    (e: unknown) =>
      e instanceof Cfdi40Error && e.issues[0].code === "SAT_RESOURCE_CORRUPT",
  );
});

test("SAT scripts never download and refuse to overwrite a modified official resource", async () => {
  for (const file of [
    "scripts/sat/build-cfdi40-resources.mjs",
    "scripts/sat/build-catcfdi.mjs",
  ]) {
    const text = await readFile(file, "utf8");
    assert(
      !/\bfetch\(|node:https?|from "https?"|XMLHttpRequest|child_process/.test(
        text,
      ),
      file,
    );
  }
  assert(
    !/copyFileSync|rmSync|unlinkSync|renameSync/.test(
      await readFile("scripts/sat/build-catcfdi.mjs", "utf8"),
    ),
    "the catalog script only reads resources/sat",
  );

  // Run the resource script in an isolated directory whose stored copy is official and
  // whose "download" differs by one byte: it must stop without touching anything.
  const cwd = await mkdtemp(join(tmpdir(), "orbit-cfdi40-script-"));
  const downloads = join(cwd, "downloads");
  await mkdir(join(cwd, cfdi40ResourceDirectory), { recursive: true });
  await mkdir(downloads);
  const official = await readFile("resources/sat/cfdi40/cfdv40.xsd");
  await writeFile(join(cwd, "resources/sat/cfdi40/cfdv40.xsd"), official);
  const modified = Buffer.from(official);
  modified[200] ^= 1;
  await writeFile(join(downloads, "cfdv40.xsd"), modified);
  await writeFile(join(downloads, "cfdv40.xsd.headers"), "");
  const run = spawnSync(
    process.execPath,
    [
      path.resolve("scripts/sat/build-cfdi40-resources.mjs"),
      "--dir",
      downloads,
      "--obtained-at",
      "2026-10-12",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /differs from the stored copy/);
  assert.equal(
    sha256(await readFile(join(cwd, "resources/sat/cfdi40/cfdv40.xsd"))),
    cfdi40Manifest.resources.find((r) => r.name === "cfdv40.xsd")!.sha256,
  );
  await assert.rejects(readdir(join(cwd, "src")));
});
