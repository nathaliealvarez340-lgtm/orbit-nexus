import assert from "node:assert/strict";
import { before, test } from "node:test";
import { X509Certificate, createHash, randomBytes, verify } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import cfdi40Manifest from "../src/lib/sat/cfdi40/manifest.json";
import bundleJson from "../src/lib/sat/cfdi40/cadenaoriginal-xslt.json";
import {
  buildPreSealCfdi40,
  buildUnsignedCfdi40,
} from "../src/lib/cfdi40/build";
import {
  loadCfdi40Catalogs,
  type Cfdi40Catalogs,
} from "../src/lib/cfdi40/catalogs";
import {
  certificateBindingFromDer,
  certificateBindingProblems,
} from "../src/lib/cfdi40/certificate-binding";
import { Cfdi40Error } from "../src/lib/cfdi40/errors";
import {
  generateCfdi40OriginalString,
  tradikXsltEngine,
  unavailableXsltEngine,
  type Cfdi40XsltEngine,
  type TradikXsltModule,
} from "../src/lib/cfdi40/original-string";
import {
  isSealedCfdi40,
  pacSubmission,
  sealAttributeProblems,
} from "../src/lib/cfdi40/sealed";
import {
  isPreSealCfdi40,
  serializePreSealCfdi40,
} from "../src/lib/cfdi40/serialize";
import type {
  Cfdi40CertificateBinding,
  PreSealCfdi40Xml,
} from "../src/lib/cfdi40/types";
import {
  loadCfdi40XsltBundle,
  resolveSatXsltInclude,
  verifyCfdi40XsltBundle,
  type Cfdi40XsltBundle,
} from "../src/lib/cfdi40/xslt-resources";
import { issuedAt, validFixtures } from "./fixtures/cfdi40";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.5: cadena original with the official SAT XSLT. No XSLT engine is approved yet
// (dependency gate, docs/tasks/FASE5C5-CADENA-ORIGINAL.md), so the generator is exercised
// through its port with a reference engine that answers from evidence-backed fixtures; the
// fixtures themselves are proven here (SAT test CSD seals verified with node:crypto).

const fixtures = "tests/fixtures/cfdi40/cadena";
const satCfd = "http://www.sat.gob.mx/sitio_internet/cfd/";
const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const codeOf = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    if (error instanceof Cfdi40Error) return error.issues[0].code;
    throw error;
  }
  return "NO_ERROR";
};
const xsltEntries = cfdi40Manifest.resources.filter(
  (r) => r.kind === "XSLT" || r.kind === "XSLT_INCLUDE",
);
const root = cfdi40Manifest.resources.find((r) => r.kind === "XSLT")!;
const includes = cfdi40Manifest.resources.filter(
  (r) => r.kind === "XSLT_INCLUDE",
);
type ManifestResources = Parameters<typeof verifyCfdi40XsltBundle>[1];

let catalogs: Cfdi40Catalogs;
let bundle: Cfdi40XsltBundle;
let binding: Cfdi40CertificateBinding;
const orbit = new Map<string, { xml: string; cadena: string }>();
before(async () => {
  catalogs = await loadCfdi40Catalogs();
  bundle = await loadCfdi40XsltBundle();
  binding = {
    noCertificado: "30001000000000000001",
    certificadoBase64: (
      await readFile(join(fixtures, "synthetic-seal-certificate.cer"))
    ).toString("base64"),
  };
  for (const name of Object.keys(validFixtures))
    orbit.set(name, {
      xml: await readFile(
        join(fixtures, "orbit", name + ".preseal.xml"),
        "utf8",
      ),
      cadena: await readFile(
        join(fixtures, "orbit", name + ".cadena.txt"),
        "utf8",
      ),
    });
});

/** Behaves like an engine at the port: loads every include, answers from fixtures. */
function referenceEngine(answers: ReadonlyMap<string, string>) {
  const calls = {
    compile: 0,
    includes: [] as string[],
    rootUrl: "",
    bom: false,
  };
  const engine: Cfdi40XsltEngine = {
    id: "reference-fixtures@test",
    compile(stylesheet, loadInclude) {
      calls.compile++;
      calls.rootUrl = stylesheet.url;
      calls.bom = stylesheet.text.charCodeAt(0) === 0xfeff;
      for (const [, href] of stylesheet.text.matchAll(
        /<xsl:include\s+href="([^"]+)"/g,
      )) {
        const text = loadInclude(href);
        assert.notEqual(text.charCodeAt(0), 0xfeff, "the BOM is not content");
        assert(text.includes("<xsl:stylesheet"));
        calls.includes.push(href);
      }
      return {
        transformToText(xml) {
          const answer = answers.get(xml);
          if (answer === undefined) throw new Error("no answer for this XML");
          return answer;
        },
      };
    },
  };
  return { engine, calls };
}
const preSeal = (name: keyof typeof validFixtures, certificate = binding) =>
  buildPreSealCfdi40(validFixtures[name].invoice(), {
    issuedAt,
    catalogs,
    certificate,
  }).xml;

// --- Official resources -------------------------------------------------------------------

test("the cadena original XSLT and its 33 includes are versioned byte-exact with origin and parent", async () => {
  assert.equal(root.name, "cadenaoriginal_4_0.xslt");
  assert.equal(root.includesStored, true);
  assert.equal(includes.length, 33);
  assert.deepEqual(
    includes.map((r) => r.url).sort(),
    [...root.includes!].sort(),
    "exactly the includes the root references",
  );
  for (const r of xsltEntries) {
    const bytes = await readFile(r.stored as string);
    assert.equal(bytes.length, r.bytes, r.name);
    assert.equal(sha256(bytes), r.sha256, r.name);
    assert.equal(r.xsltVersion, "2.0", r.name);
    assert.equal(r.obtainedAt, "2026-10-12");
    assert(r.lastModified && r.etag, r.name);
  }
  for (const r of includes) {
    assert(r.url.startsWith(satCfd), r.url);
    assert.equal(r.name, "xslt/" + r.url.slice(satCfd.length));
    assert.equal(r.stored, "resources/sat/cfdi40/" + r.name);
    assert.equal(r.referencedBy, "cadenaoriginal_4_0.xslt");
    assert.deepEqual(r.includes, [], "no transitive includes");
  }
  // Several official files start with a UTF-8 BOM; it is kept byte for byte.
  const withBom = (
    await Promise.all(
      includes.map(async (r) => (await readFile(r.stored as string))[0]),
    )
  ).filter((byte) => byte === 0xef).length;
  assert(withBom > 0);
});

test("the server bundle is exactly the versioned files and the manifest", async () => {
  assert.equal(bundleJson.root, root.url);
  assert.equal(bundleJson.resources.length, xsltEntries.length);
  for (const entry of bundleJson.resources) {
    const manifestEntry = xsltEntries.find((r) => r.url === entry.url)!;
    assert.equal(entry.name, manifestEntry.name);
    assert.equal(entry.sha256, manifestEntry.sha256);
    assert(
      Buffer.from(entry.text, "utf8").equals(
        await readFile(manifestEntry.stored as string),
      ),
      entry.name,
    );
  }
  assert.equal(bundle.rootUrl, root.url);
  assert.equal(bundle.rootSha256, root.sha256);
  assert.equal(bundle.includes.size, 33);
  assert.equal(await loadCfdi40XsltBundle(), bundle, "loaded once");
});

test("a modified, missing, extra or unreferenced XSLT resource fails closed", () => {
  const resources = bundleJson.resources;
  const pagos = resources.findIndex(
    (r) => r.name === "xslt/Pagos/Pagos20.xslt",
  );
  const replaced = (
    index: number,
    change: Partial<(typeof resources)[number]>,
  ) => resources.map((r, i) => (i === index ? { ...r, ...change } : r));
  const tampered = resources[pagos].text.replace("Pagos", "Pag0s");
  for (const [label, source, code] of [
    [
      "one character",
      { root: bundleJson.root, resources: replaced(pagos, { text: tampered }) },
      "SAT_XSLT_RESOURCE_INTEGRITY_FAILED",
    ],
    [
      "text and its declared hash",
      {
        root: bundleJson.root,
        resources: replaced(pagos, {
          text: tampered,
          sha256: sha256(tampered),
        }),
      },
      "SAT_XSLT_RESOURCE_INTEGRITY_FAILED",
    ],
    [
      "BOM removed",
      {
        root: bundleJson.root,
        resources: resources.map((r) => ({
          ...r,
          text: r.text.charCodeAt(0) === 0xfeff ? r.text.slice(1) : r.text,
        })),
      },
      "SAT_XSLT_RESOURCE_INTEGRITY_FAILED",
    ],
    [
      "include missing",
      {
        root: bundleJson.root,
        resources: resources.filter((_, i) => i !== pagos),
      },
      "SAT_XSLT_RESOURCE_MISSING",
    ],
    [
      "unknown resource",
      {
        root: bundleJson.root,
        resources: [
          ...resources,
          {
            url: satCfd + "otro/otro.xslt",
            name: "xslt/otro/otro.xslt",
            sha256: "0",
            text: "<x/>",
          },
        ],
      },
      "SAT_XSLT_RESOURCE_NOT_ALLOWED",
    ],
    [
      "another root",
      {
        root: satCfd + "3/cadenaoriginal_3_3/cadenaoriginal_3_3.xslt",
        resources,
      },
      "SAT_XSLT_RESOURCE_MISSING",
    ],
  ] as const)
    assert.equal(
      codeOf(() => verifyCfdi40XsltBundle(source)),
      code,
      label,
    );
  // The root references an include the manifest does not version.
  const unversioned = cfdi40Manifest.resources.filter(
    (r) => r.name !== "xslt/Pagos/Pagos20.xslt",
  ) as ManifestResources;
  assert.equal(
    codeOf(() =>
      verifyCfdi40XsltBundle(
        {
          root: bundleJson.root,
          resources: resources.filter((_, i) => i !== pagos),
        },
        unversioned,
      ),
    ),
    "SAT_XSLT_RESOURCE_MISSING",
  );
});

test("xsl:include resolves only to allowlisted official resources: no files, network or SSRF", () => {
  for (const [url, text] of bundle.includes)
    assert.equal(resolveSatXsltInclude(bundle, url), text);
  for (const href of [
    "Pagos20.xslt",
    "./Pagos/Pagos20.xslt",
    "/sitio_internet/cfd/Pagos/Pagos20.xslt",
    "https://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xslt",
    "http://www.sat.gob.mx/sitio_internet/cfd/Pagos/../Pagos/Pagos20.xslt",
    "http://www.sat.gob.mx:80/sitio_internet/cfd/Pagos/Pagos20.xslt",
    "HTTP://WWW.SAT.GOB.MX/sitio_internet/cfd/Pagos/Pagos20.xslt",
    "http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xslt?v=2",
    "http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xslt#x",
    "http://user@www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xslt",
    "http://www.sat.gob.mx/sitio_internet/cfd/otro/desconocido.xslt",
    "http://www.sat.gob.mx/sitio_internet/cfd/4/cadenaoriginal_4_0/cadenaoriginal_4_0.xslt",
    "http://sat.gob.mx.evil.example/sitio_internet/cfd/Pagos/Pagos20.xslt",
    "http://localhost/sitio_internet/cfd/Pagos/Pagos20.xslt",
    "http://127.0.0.1/x.xslt",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
    "file:///C:/Windows/win.ini",
    "data:text/xml,<x/>",
    "javascript:alert(1)",
    "",
  ])
    assert.equal(
      codeOf(() => resolveSatXsltInclude(bundle, href)),
      "SAT_XSLT_RESOURCE_NOT_ALLOWED",
      href,
    );
});

test("the SAT XSLT set uses only XSLT 1.0 instructions and two XPath functions (re-audit if it changes)", () => {
  const instructions = new Set<string>();
  const functions = new Set<string>();
  let outputs = 0;
  for (const { text } of bundleJson.resources) {
    for (const [, name] of text.matchAll(/<xsl:([A-Za-z-]+)/g))
      instructions.add(name);
    for (const [, expression] of text.matchAll(
      /\b(?:select|test|match)="([^"]*)"/g,
    ))
      for (const [, fn] of expression.matchAll(/([A-Za-z][A-Za-z0-9-]*)\(/g))
        functions.add(fn);
    assert(!/\s(as|use-when|xpath-default-namespace)="/.test(text));
    // Where a stylesheet declares its output, it is plain UTF-8 text.
    for (const [declaration] of text.matchAll(/<xsl:output\b[^>]*>/g)) {
      outputs++;
      assert.equal(
        declaration,
        '<xsl:output method="text" version="1.0" encoding="UTF-8" indent="no"/>',
      );
    }
  }
  // At least the root declares its output (the check above is not vacuous).
  assert(outputs >= 1, "xsl:output declarations checked");
  assert.deepEqual([...instructions].sort(), [
    "apply-templates",
    "call-template",
    "for-each",
    "if",
    "include",
    "output",
    "param",
    "stylesheet",
    "template",
    "value-of",
    "with-param",
  ]);
  assert.deepEqual([...functions].sort(), ["normalize-space", "string"]);
  assert(
    bundle.root.includes(
      '<xsl:output method="text" version="1.0" encoding="UTF-8" indent="no"/>',
    ),
  );
});

test("the cadena modules never read files, call the network, evaluate code or spawn processes", async () => {
  for (const file of [
    "original-string.ts",
    "xslt-engine.ts",
    "xslt-resources.ts",
    "certificate-binding.ts",
    "serialize.ts",
    "../csd/certificate-number.ts",
  ]) {
    const text = await readFile(join("src/lib/cfdi40", file), "utf8");
    assert(
      !/\bfetch\(|XMLHttpRequest|node:(fs|http|https|net|child_process|worker_threads)|from "(fs|http|https)"|\beval\(|new Function|process\.env/.test(
        text,
      ),
      file,
    );
  }
});

// --- Pre-seal XML and certificate --------------------------------------------------------

test("pre-seal XML: the CSD certificate in cfdv40.xsd order, no Sello, deterministic", () => {
  for (const name of Object.keys(
    validFixtures,
  ) as (keyof typeof validFixtures)[]) {
    const xml = preSeal(name);
    assert(isPreSealCfdi40(xml));
    assert.equal(xml.xml, orbit.get(name)!.xml, name);
    assert.equal(preSeal(name).sha256, xml.sha256, "same input, same bytes");
    const at = (attribute: string) => xml.xml.indexOf(` ${attribute}="`);
    assert(
      at("FormaPago") < at("NoCertificado") &&
        at("NoCertificado") < at("Certificado") &&
        at("Certificado") < at("SubTotal"),
      name,
    );
    assert.equal(at("Sello"), -1);
    // Exactly the unsigned XML plus the two certificate attributes.
    const unsigned = buildUnsignedCfdi40(validFixtures[name].invoice(), {
      issuedAt,
      catalogs,
    }).xml.xml;
    assert.equal(
      xml.xml.replace(/ NoCertificado="[^"]*" Certificado="[^"]*"/, ""),
      unsigned,
    );
    // Never treated as sealed.
    assert(sealAttributeProblems(xml.xml).includes("SELLO_MISSING"));
    assert.equal(isSealedCfdi40(xml), false);
    assert.equal(
      codeOf(() => pacSubmission(xml)),
      "SEALED_CFDI_REQUIRED",
    );
  }
});

test("certificate binding: only a usable public seal certificate, never a placeholder", () => {
  const at = new Date("2026-10-12T18:00:00Z");
  assert.deepEqual(certificateBindingProblems(binding, at), []);
  const authority = syntheticAuthority();
  const der = (options: Parameters<typeof syntheticCsd>[1] = {}) =>
    Buffer.from(syntheticCsd(authority, options).certificate).toString(
      "base64",
    );
  for (const [label, candidate, problem] of [
    [
      "empty NoCertificado",
      { ...binding, noCertificado: "" },
      "NO_CERTIFICADO_INVALID",
    ],
    [
      "short NoCertificado",
      { ...binding, noCertificado: "1234" },
      "NO_CERTIFICADO_INVALID",
    ],
    [
      "zeros NoCertificado",
      { ...binding, noCertificado: "0".repeat(20) },
      "NO_CERTIFICADO_MISMATCH",
    ],
    [
      "empty Certificado",
      { ...binding, certificadoBase64: "" },
      "CERTIFICADO_INVALID",
    ],
    [
      "placeholder Certificado",
      { ...binding, certificadoBase64: "PLACEHOLDER" },
      "CERTIFICADO_INVALID",
    ],
    [
      "random bytes",
      { ...binding, certificadoBase64: randomBytes(600).toString("base64") },
      "CERTIFICADO_INVALID",
    ],
    [
      "CA certificate",
      {
        ...binding,
        certificadoBase64: Buffer.from(authority.certificate).toString(
          "base64",
        ),
      },
      "NOT_A_SEAL_CERTIFICATE",
    ],
    [
      "EC key",
      {
        ...binding,
        certificadoBase64: der({
          keyType: "ec",
          certificateNumber: binding.noCertificado,
        }),
      },
      "NOT_A_SEAL_CERTIFICATE",
    ],
    [
      "other certificate",
      { ...binding, certificadoBase64: der() },
      "NO_CERTIFICADO_MISMATCH",
    ],
  ] as const)
    assert(
      certificateBindingProblems(candidate).includes(problem),
      `${label} -> ${problem}`,
    );
  for (const instant of ["2025-12-31T23:59:59Z", "2036-01-01T00:00:00Z"])
    assert(
      certificateBindingProblems(binding, new Date(instant)).includes(
        "OUTSIDE_VALIDITY",
      ),
    );
  // Writing the pre-seal XML or building it refuses the same values.
  const document = buildUnsignedCfdi40(validFixtures["ingreso-ppd"].invoice(), {
    issuedAt,
    catalogs,
  }).document;
  assert.equal(
    codeOf(() =>
      serializePreSealCfdi40(document, { ...binding, noCertificado: "" }),
    ),
    "CERTIFICATE_BINDING_INVALID",
  );
  const expired = syntheticCsd(authority, {
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validTo: new Date("2026-06-01T00:00:00Z"),
  });
  assert.equal(
    codeOf(() =>
      preSeal("ingreso-ppd", {
        noCertificado: expired.certificateNumber,
        certificadoBase64: Buffer.from(expired.certificate).toString("base64"),
      }),
    ),
    "CERTIFICATE_BINDING_INVALID",
    "not in force at the issue instant",
  );
  // From a stored CSD record: the DER must be the certificate the record describes.
  const stored = Buffer.from(binding.certificadoBase64, "base64");
  const record = {
    certificateSha256: sha256(stored),
    serialNumberHex: new X509Certificate(stored).serialNumber,
    certificateNumber: binding.noCertificado,
  };
  assert.deepEqual(certificateBindingFromDer(stored, record, at), binding);
  for (const change of [
    { certificateSha256: "0".repeat(64) },
    { serialNumberHex: "00" },
    { certificateNumber: "30001000000000000002" },
  ])
    assert.equal(
      codeOf(() =>
        certificateBindingFromDer(stored, { ...record, ...change }, at),
      ),
      "CSD_CERTIFICATE_MISMATCH",
      JSON.stringify(change),
    );
  assert.equal(
    codeOf(() =>
      certificateBindingFromDer(
        stored,
        record,
        new Date("2036-06-01T00:00:00Z"),
      ),
    ),
    "CERTIFICATE_BINDING_INVALID",
  );
});

// --- Generator ------------------------------------------------------------------------------

test("the generator returns the official XSLT output exactly, deterministically, from pre-seal XML only", () => {
  assert.equal(
    codeOf(() =>
      generateCfdi40OriginalString(preSeal("ingreso-pue-iva16"), {
        engine: unavailableXsltEngine,
        bundle,
      }),
    ),
    "XSLT_ENGINE_UNAVAILABLE",
  );
  const answers = new Map([...orbit.values()].map((f) => [f.xml, f.cadena]));
  const { engine, calls } = referenceEngine(answers);
  for (const name of Object.keys(
    validFixtures,
  ) as (keyof typeof validFixtures)[]) {
    const xml = preSeal(name);
    const result = generateCfdi40OriginalString(xml, { engine, bundle });
    const expected = orbit.get(name)!.cadena;
    assert.equal(result.stage, "ORIGINAL_STRING");
    assert.equal(result.value, expected, name);
    assert(Buffer.from(result.bytes).equals(Buffer.from(expected, "utf8")));
    assert.equal(result.sha256, sha256(Buffer.from(expected, "utf8")));
    assert.equal(result.preSealSha256, xml.sha256);
    assert.equal(result.noCertificado, binding.noCertificado);
    assert.deepEqual(result.xslt, {
      rootSha256: root.sha256,
      engine: "reference-fixtures@test",
    });
    assert.deepEqual(
      generateCfdi40OriginalString(preSeal(name), { engine, bundle }),
      result,
      "same XML, same resources, same cadena",
    );
  }
  assert.equal(calls.compile, 1, "compiled once per engine and bundle");
  assert.equal(calls.rootUrl, root.url);
  assert.equal(calls.bom, false);
  assert.deepEqual([...calls.includes].sort(), [...root.includes!].sort());
  // Unicode, escapes, spaces and decimals survive exactly (UTF-8, no trim, no re-encoding).
  const unicode = generateCfdi40OriginalString(
    preSeal("ingreso-unicode-escape"),
    {
      engine,
      bundle,
    },
  );
  assert(unicode.value.includes(`|Diseño & "montaje" <ÑANDÚ> 'año' 2026 🚀|`));
  assert(unicode.value.includes("|CAFÉ <EL SOL>|"));
  assert(unicode.value.includes("|Tasa|0.160000|16.00|"));
  assert(unicode.bytes.length > unicode.value.length);
});

test("the generator refuses anything but ORBIT pre-seal XML and invalid engine output", () => {
  const xml = preSeal("ingreso-pue-iva16");
  const expected = orbit.get("ingreso-pue-iva16")!.cadena;
  const unsigned = buildUnsignedCfdi40(
    validFixtures["ingreso-pue-iva16"].invoice(),
    {
      issuedAt,
      catalogs,
    },
  ).xml;
  const { engine } = referenceEngine(new Map([[xml.xml, expected]]));
  for (const candidate of [
    unsigned,
    { ...xml },
    { ...xml, xml: xml.xml.replace("1000.00", "1.00") },
  ])
    assert.equal(
      codeOf(() =>
        generateCfdi40OriginalString(candidate as unknown as PreSealCfdi40Xml, {
          engine,
          bundle,
        }),
      ),
      "PRE_SEAL_CFDI_REQUIRED",
    );
  assert.equal(
    codeOf(() =>
      // @ts-expect-error The generator only accepts the pre-seal representation.
      generateCfdi40OriginalString(unsigned, { engine, bundle }),
    ),
    "PRE_SEAL_CFDI_REQUIRED",
  );
  const answering = (value: unknown): Cfdi40XsltEngine => ({
    id: "answering@test",
    compile: () => ({ transformToText: () => value as string }),
  });
  for (const value of [
    " " + expected,
    expected + "\n",
    expected.replace("||", "|"),
    expected.replace(binding.noCertificado, "30001000000000000099"),
    "",
    42,
  ])
    assert.equal(
      codeOf(() =>
        generateCfdi40OriginalString(xml, { engine: answering(value), bundle }),
      ),
      "ORIGINAL_STRING_INVALID",
      JSON.stringify(value),
    );
  const throwing: Cfdi40XsltEngine = {
    id: "throwing@test",
    compile: () => ({
      transformToText: () => {
        throw new Error("engine failure with " + xml.xml);
      },
    }),
  };
  let caught: unknown;
  try {
    generateCfdi40OriginalString(xml, { engine: throwing, bundle });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Cfdi40Error);
  assert.equal(caught.issues[0].code, "XSLT_TRANSFORM_FAILED");
  assert(!JSON.stringify(caught.issues).includes("SCA010101AB1"));
  // A refused include wins over however the engine wraps the loader error.
  const wrapping: Cfdi40XsltEngine = {
    id: "wrapping@test",
    compile(_stylesheet, loadInclude) {
      try {
        loadInclude("file:///etc/passwd");
      } catch {
        throw new Error("Cannot load stylesheet");
      }
      throw new Error("unreachable");
    },
  };
  assert.equal(
    codeOf(() =>
      generateCfdi40OriginalString(xml, { engine: wrapping, bundle }),
    ),
    "SAT_XSLT_RESOURCE_NOT_ALLOWED",
  );
});

test("the @tradik/xslt-processor adapter only loads includes through the allowlist", () => {
  const seen: {
    options?: Record<string, unknown>;
    imported?: unknown[];
    source?: unknown;
  } = {};
  class FakeXsltEngine {
    constructor(options: Record<string, unknown>) {
      seen.options = options;
    }
    importStylesheet(stylesheet: unknown, uri?: string) {
      seen.imported = [stylesheet, uri];
    }
    transformToString(source: unknown) {
      seen.source = source;
      return "||ok||";
    }
  }
  const parser = {
    parseFromString: (text: string, type: string) => ({ text, type }),
  };
  const engine = tradikXsltEngine(
    { XsltEngine: FakeXsltEngine } as unknown as TradikXsltModule,
    parser,
    "@tradik/xslt-processor@1.3.4",
  );
  const loaded: string[] = [];
  const compiled = engine.compile(
    { url: root.url, text: "<root/>" },
    (href) => {
      loaded.push(href);
      return resolveSatXsltInclude(bundle, href);
    },
  );
  const options = seen.options as {
    stylesheetLoader: (href: string, base?: string) => string;
    documentLoader: (uri: string) => string;
    domParser: unknown;
  };
  assert.equal(options.domParser, parser);
  const pagos = satCfd + "Pagos/Pagos20.xslt";
  assert.equal(
    options.stylesheetLoader(pagos, root.url),
    bundle.includes.get(pagos),
  );
  assert.equal(
    codeOf(() => options.stylesheetLoader("file:///etc/passwd")),
    "SAT_XSLT_RESOURCE_NOT_ALLOWED",
  );
  assert.equal(
    codeOf(() => options.documentLoader(pagos)),
    "SAT_XSLT_RESOURCE_NOT_ALLOWED",
  );
  assert.deepEqual(loaded, [pagos, "file:///etc/passwd"]);
  assert.deepEqual(seen.imported, [
    { text: "<root/>", type: "text/xml" },
    root.url,
  ]);
  assert.equal(compiled.transformToText("<cfdi/>"), "||ok||");
  assert.deepEqual(seen.source, { text: "<cfdi/>", type: "text/xml" });
});

// --- Evidence ---------------------------------------------------------------------------------

test("expected cadenas are evidence-backed: PAC test CFDI seals verify over them", async () => {
  const provenance = JSON.parse(
    await readFile(join(fixtures, "sw", "provenance.json"), "utf8"),
  ) as {
    fixtures: {
      fixture: string;
      source: string;
      sha256: string;
      cadenaSha256: string;
      evidence: "SEAL_VERIFIED" | "DUAL_ENGINE";
    }[];
  };
  const files = (await readdir(join(fixtures, "sw"))).filter((f) =>
    f.endsWith(".xml"),
  );
  assert.equal(files.length, provenance.fixtures.length);
  let verified = 0;
  for (const entry of provenance.fixtures) {
    assert.match(
      entry.source,
      /^https:\/\/github\.com\/lunasoft\/sw-sdk-[a-z]+\/blob\/[0-9a-f]{40}\//,
    );
    const xml = await readFile(join(fixtures, "sw", entry.fixture + ".xml"));
    const cadena = await readFile(
      join(fixtures, "sw", entry.fixture + ".cadena.txt"),
    );
    assert.equal(sha256(xml), entry.sha256, entry.fixture);
    assert.equal(sha256(cadena), entry.cadenaSha256, entry.fixture);
    const text = cadena.toString("utf8");
    assert.match(text, /^\|\|4\.0\|[^\r\n]*\|\|$/, entry.fixture);
    const attribute = (name: string) =>
      new RegExp(`<cfdi:Comprobante\\b[^>]*?\\s${name}="([^"]*)"`, "s").exec(
        xml.toString("utf8"),
      )?.[1];
    const sello = attribute("Sello");
    const certificado = attribute("Certificado");
    const noCertificado = attribute("NoCertificado");
    if (noCertificado)
      assert(text.includes(`|${noCertificado}|`), entry.fixture);
    const sealOk =
      !!sello &&
      !!certificado &&
      verify(
        "RSA-SHA256",
        cadena,
        new X509Certificate(Buffer.from(certificado, "base64")).publicKey,
        Buffer.from(sello, "base64"),
      );
    assert.equal(sealOk, entry.evidence === "SEAL_VERIFIED", entry.fixture);
    if (sealOk) verified++;
  }
  assert.equal(verified, 10);
  // ORBIT synthetic invoices: dual-engine references on the pre-seal XML of this phase.
  for (const [name, { cadena }] of orbit) {
    assert.match(
      cadena,
      /^\|\|4\.0\|ORB-000123\|2026-10-12T12:30:15\|[^\r\n]*\|\|$/,
      name,
    );
    assert(cadena.includes("|30001000000000000001|"), name);
  }
});
