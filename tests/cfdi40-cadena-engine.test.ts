import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { X509Certificate, verify } from "node:crypto";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { XsltEngine } from "@tradik/xslt-processor";
import { DOMParser } from "@xmldom/xmldom";
import cfdi40Manifest from "../src/lib/sat/cfdi40/manifest.json";
import { buildPreSealCfdi40 } from "../src/lib/cfdi40/build";
import {
  loadCfdi40Catalogs,
  type Cfdi40Catalogs,
} from "../src/lib/cfdi40/catalogs";
import { Cfdi40Error } from "../src/lib/cfdi40/errors";
import {
  compileCfdi40Xslt,
  generateCfdi40OriginalString,
  tradikXsltEngine,
  type Cfdi40XsltEngine,
  type TradikXsltModule,
  type XmlDomParser,
} from "../src/lib/cfdi40/original-string";
import {
  cfdi40XsltEngine,
  cfdi40XsltEngineId,
  generateOfficialCfdi40OriginalString,
} from "../src/lib/cfdi40/xslt-engine";
import {
  loadCfdi40XsltBundle,
  resolveSatXsltInclude,
  type Cfdi40XsltBundle,
} from "../src/lib/cfdi40/xslt-resources";
import { issuedAt, orbitInvoice, validFixtures } from "./fixtures/cfdi40";

// Fase 5C.5 real-engine gate (mandatory): the INSTALLED approved engine runs the official SAT
// XSLT from the verified bundle. Every expected cadena was produced identically by Microsoft
// .NET XslCompiledTransform (independent reference); 10 PAC test CFDI also verify their own
// Sello over it. Network, files and console are blocked and recorded while it runs.

const fixtures = "tests/fixtures/cfdi40/cadena";
const root = cfdi40Manifest.resources.find((r) => r.kind === "XSLT")!;
const certificate = {
  noCertificado: "30001000000000000001",
  certificadoBase64: "",
};
type Provenance = {
  fixtures: { fixture: string; evidence: "SEAL_VERIFIED" | "DUAL_ENGINE" }[];
};
const bom = String.fromCharCode(0xfeff);

let catalogs: Cfdi40Catalogs;
let bundle: Cfdi40XsltBundle;
let provenance: Provenance;
const expected = new Map<string, string>();
const pac = new Map<string, { xml: string; cadena: string }>();

// Recorded side effects while the engine runs.
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

before(async () => {
  catalogs = await loadCfdi40Catalogs();
  bundle = await loadCfdi40XsltBundle();
  certificate.certificadoBase64 = (
    await readFile(join(fixtures, "synthetic-seal-certificate.cer"))
  ).toString("base64");
  for (const name of Object.keys(validFixtures))
    expected.set(
      name,
      await readFile(join(fixtures, "orbit", name + ".cadena.txt"), "utf8"),
    );
  provenance = JSON.parse(
    await readFile(join(fixtures, "sw", "provenance.json"), "utf8"),
  );
  for (const { fixture } of provenance.fixtures) {
    const xml = await readFile(join(fixtures, "sw", fixture + ".xml"), "utf8");
    pac.set(fixture, {
      xml: xml.startsWith(bom) ? xml.slice(1) : xml,
      cadena: await readFile(
        join(fixtures, "sw", fixture + ".cadena.txt"),
        "utf8",
      ),
    });
  }
  // From here on nothing may touch the network, the filesystem or the console.
  guard(globalThis, "fetch", "fetch", true);
  guard(net.Socket.prototype, "connect", "net.connect", true);
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
});
after(() => {
  for (const undo of restore.reverse()) undo();
});

const preSeal = (name: keyof typeof validFixtures) =>
  buildPreSealCfdi40(validFixtures[name].invoice(), {
    issuedAt,
    catalogs,
    certificate,
  }).xml;
const codeOf = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return error instanceof Cfdi40Error ? error.issues[0].code : "OTHER_ERROR";
  }
  return "NO_ERROR";
};

test("the installed engine compiles the official XSLT with all 33 includes from the verified bundle", () => {
  const loaded: string[] = [];
  const recording: Cfdi40XsltEngine = {
    id: cfdi40XsltEngineId,
    compile: (stylesheet, loadInclude) =>
      cfdi40XsltEngine.compile(stylesheet, (href) => {
        loaded.push(href);
        return loadInclude(href);
      }),
  };
  const result = generateCfdi40OriginalString(preSeal("ingreso-pue-iva16"), {
    engine: recording,
    bundle,
  });
  assert.deepEqual([...loaded].sort(), [...root.includes!].sort());
  assert.equal(loaded.length, 33);
  assert.equal(result.value, expected.get("ingreso-pue-iva16"));
  assert.equal(result.xslt.engine, cfdi40XsltEngineId);
  assert.equal(result.xslt.rootSha256, root.sha256);
});

test("ORBIT invoices: the production cadena is byte-identical to the .NET reference", async () => {
  // PUE, PPD, IVA 16 %, exempt, discount, several concepts, withholdings, Unicode and
  // escaping, MXN, USD with exchange rate, generic receiver and persona física.
  assert.deepEqual(Object.keys(validFixtures).sort(), [
    "ingreso-descuento",
    "ingreso-exento",
    "ingreso-multiples-conceptos",
    "ingreso-persona-fisica",
    "ingreso-ppd",
    "ingreso-pue-iva16",
    "ingreso-retenciones-persona-moral",
    "ingreso-rfc-generico-nacional",
    "ingreso-unicode-escape",
    "ingreso-usd-tipo-cambio",
  ]);
  for (const name of Object.keys(
    validFixtures,
  ) as (keyof typeof validFixtures)[]) {
    const result = await generateOfficialCfdi40OriginalString(preSeal(name));
    const reference = expected.get(name)!;
    assert.equal(result.value, reference, name);
    assert(
      Buffer.from(result.bytes).equals(Buffer.from(reference, "utf8")),
      name,
    );
  }
  const unicode = await generateOfficialCfdi40OriginalString(
    preSeal("ingreso-unicode-escape"),
  );
  assert(unicode.value.includes(`|Diseño & "montaje" <ÑANDÚ> 'año' 2026 🚀|`));
  const usd = await generateOfficialCfdi40OriginalString(
    preSeal("ingreso-usd-tipo-cambio"),
  );
  assert.match(usd.value, /\|USD\|17\.25\d*\|/);
  const generic = await generateOfficialCfdi40OriginalString(
    preSeal("ingreso-rfc-generico-nacional"),
  );
  assert(generic.value.includes("|XAXX010101000|"));
});

test("PAC test CFDI: the installed engine reproduces the .NET reference and the SAT test CSD seals verify", () => {
  const compiled = compileCfdi40Xslt(cfdi40XsltEngine, bundle);
  let verified = 0;
  for (const { fixture, evidence } of provenance.fixtures) {
    const { xml, cadena } = pac.get(fixture)!;
    const value = compiled.transformToText(xml);
    assert.equal(value, cadena, fixture);
    if (evidence !== "SEAL_VERIFIED") continue;
    const attribute = (name: string) =>
      new RegExp(`<cfdi:Comprobante\\b[^>]*?\\s${name}="([^"]*)"`, "s").exec(
        xml,
      )![1];
    assert(
      verify(
        "RSA-SHA256",
        Buffer.from(value, "utf8"),
        new X509Certificate(Buffer.from(attribute("Certificado"), "base64"))
          .publicKey,
        Buffer.from(attribute("Sello"), "base64"),
      ),
      fixture,
    );
    verified++;
  }
  assert.equal(verified, 10);
  assert.equal(provenance.fixtures.length, 15);
});

test("the cadena is deterministic across runs and independent engine instances", async () => {
  const fresh = tradikXsltEngine(
    { XsltEngine } as unknown as TradikXsltModule,
    new DOMParser({
      onError(level) {
        if (level !== "warning") throw new Error("XML_PARSE_FAILED");
      },
    }) as unknown as XmlDomParser,
    "fresh-instance",
  );
  for (const name of Object.keys(
    validFixtures,
  ) as (keyof typeof validFixtures)[]) {
    const first = await generateOfficialCfdi40OriginalString(preSeal(name));
    const second = await generateOfficialCfdi40OriginalString(preSeal(name));
    const other = generateCfdi40OriginalString(preSeal(name), {
      engine: fresh,
      bundle,
    });
    assert.equal(first.sha256, second.sha256, name);
    assert.equal(other.sha256, first.sha256, name);
    assert.equal(first.preSealSha256, second.preSealSha256, name);
  }
  const compiledAgain = compileCfdi40Xslt(fresh, bundle);
  for (const [fixture, { xml, cadena }] of pac)
    assert.equal(compiledAgain.transformToText(xml), cadena, fixture);
});

test("the installed engine resolves nothing outside the allowlist and refuses document()", () => {
  const stylesheet = (body: string) =>
    '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">' +
    body +
    "</xsl:stylesheet>";
  const allowlist = (href: string) => resolveSatXsltInclude(bundle, href);
  for (const href of [
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
    "../../.env",
    "https://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xslt",
  ])
    assert.notEqual(
      codeOf(() =>
        cfdi40XsltEngine.compile(
          { url: root.url, text: stylesheet(`<xsl:include href="${href}"/>`) },
          allowlist,
        ),
      ),
      "NO_ERROR",
      href,
    );
  const reader = cfdi40XsltEngine.compile(
    {
      url: root.url,
      text: stylesheet(
        `<xsl:output method="text"/><xsl:template match="/"><xsl:value-of select="document('file:///etc/passwd')"/></xsl:template>`,
      ),
    },
    allowlist,
  );
  assert.notEqual(
    codeOf(() => reader.transformToText("<a/>")),
    "NO_ERROR",
  );
});

test("text the parsers would read differently never reaches the engine", () => {
  // xmldom normalizes U+2028/U+2029 as line ends (XML 1.1 rule); XML 1.0 parsers keep them.
  const parsed = new DOMParser({ onError() {} }).parseFromString(
    `<a b="x${String.fromCharCode(0x2028)}y"/>`,
    "text/xml",
  );
  assert.notEqual(
    parsed.documentElement!.getAttribute("b"),
    "x" + String.fromCharCode(0x2028) + "y",
  );
  for (const code of [0x2028, 0x2029, 0x85]) {
    const invoice = orbitInvoice([
      {
        quantity: "1",
        unitPrice: "100",
        description: "Servicio" + String.fromCharCode(code) + "mensual",
      },
    ]);
    let issue = "";
    try {
      buildPreSealCfdi40(invoice, { issuedAt, catalogs, certificate });
    } catch (error) {
      if (error instanceof Cfdi40Error) issue = error.issues[0].code;
    }
    assert.equal(issue, "TEXT_INVALID_CHARACTER", code.toString(16));
  }
});

test("while the engine ran: no network, no file access, no console output", () => {
  assert.deepEqual(attempts, []);
  assert.deepEqual(output, []);
  // The guards are live: each of these is caught and recorded.
  assert.throws(() => fetch("http://example.test"));
  assert.throws(() => fs.readFileSync("package.json"));
  assert.throws(() => new net.Socket().connect(80, "example.test"));
  console.log("probe");
  assert.deepEqual(attempts, ["fetch", "fs.readFileSync", "net.connect"]);
  assert.deepEqual(output, ["console.log"]);
});
