import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPreSealCfdi40 } from "../src/lib/cfdi40/build";
import { loadCfdi40Catalogs } from "../src/lib/cfdi40/catalogs";
import {
  compileCfdi40Xslt,
  generateCfdi40OriginalString,
} from "../src/lib/cfdi40/original-string";
import { compileCfdi40Xsd } from "../src/lib/cfdi40/schema";
import { createSealedCfdi40 } from "../src/lib/cfdi40/sealed";
import { loadCfdi40XsdEngine } from "../src/lib/cfdi40/xsd-engine";
import { loadCfdi40XsdBundle } from "../src/lib/cfdi40/xsd-resources";
import { cfdi40XsltEngine } from "../src/lib/cfdi40/xslt-engine";
import { loadCfdi40XsltBundle } from "../src/lib/cfdi40/xslt-resources";
import { signCfdiSeal } from "../src/lib/csd/signing";
import { issuedAt, validFixtures } from "./fixtures/cfdi40";
import { dotnetVersion } from "./fixtures/cfdi40/seal-interop.mjs";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.7: independent evidence for the XSD engine. Microsoft .NET XmlSchemaSet (Windows
// PowerShell, test tooling only) validates the same files against the same versioned SAT
// schemas; both must agree on VALID/INVALID for sealed ORBIT CFDI, the PAC's test CFDI and
// controlled mutations. Skipped, with the reason, where Windows PowerShell/.NET is absent.
// Agreement of two validators is not "verified by the SAT".

const dotnet = dotnetVersion();

test(
  "libxml2-wasm and .NET XmlSchemaSet agree on VALID/INVALID for sealed ORBIT CFDI, PAC CFDI and mutations",
  { skip: dotnet ? false : "Windows PowerShell/.NET Framework not available" },
  async () => {
    const catalogs = await loadCfdi40Catalogs();
    const xslt = await loadCfdi40XsltBundle();
    const stylesheet = compileCfdi40Xslt(cfdi40XsltEngine, xslt);
    const xsd = compileCfdi40Xsd(
      await loadCfdi40XsdEngine(),
      await loadCfdi40XsdBundle(),
    );
    const csd = syntheticCsd(syntheticAuthority(), {
      certificateNumber: "30001000000000000001",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2036-01-01T00:00:00Z"),
    });
    const binding = {
      noCertificado: "30001000000000000001",
      certificadoBase64: Buffer.from(csd.certificate).toString("base64"),
    };
    const samples = new Map<string, string>();
    for (const name of Object.keys(validFixtures)) {
      const preSeal = buildPreSealCfdi40(validFixtures[name].invoice(), {
        issuedAt,
        catalogs,
        certificate: binding,
      }).xml;
      const cadena = generateCfdi40OriginalString(preSeal, {
        engine: cfdi40XsltEngine,
        bundle: xslt,
      });
      const sealed = createSealedCfdi40(
        preSeal,
        cadena,
        signCfdiSeal(csd.keyObject, cadena.bytes).toString("base64"),
        stylesheet,
      );
      samples.set(`orbit-${name}.xml`, sealed.xml);
    }
    const pacDirectory = "tests/fixtures/cfdi40/cadena/sw";
    for (const file of (await readdir(pacDirectory)).filter((f) =>
      f.endsWith(".xml"),
    ))
      samples.set(
        `pac-${file}`,
        readFileSync(join(pacDirectory, file), "utf8").replace(/^﻿/, ""),
      );
    const base = samples.get("orbit-ingreso-multiples-conceptos.xml")!;
    const emisor = /<cfdi:Emisor [^>]*\/>/.exec(base)![0];
    const receptor = /<cfdi:Receptor [^>]*\/>/.exec(base)![0];
    const mutations: Record<string, string> = {
      "missing-attribute": base.replace(' Moneda="MXN"', ""),
      "extra-attribute": base.replace(
        ' Version="4.0"',
        ' Version="4.0" Foo="x"',
      ),
      order: base.replace(emisor + receptor, receptor + emisor),
      version: base.replace(' Version="4.0"', ' Version="3.3"'),
      decimal: base.replace(' SubTotal="3523.82"', ' SubTotal="35.23.82"'),
      pattern: base.replace(' Rfc="SCA010101AB1"', ' Rfc="sca010101ab1"'),
      enumeration: base.replace(' Moneda="MXN"', ' Moneda="ZZZ"'),
      length: base.replace(/Folio="[^"]*"/, `Folio="${"F".repeat(41)}"`),
      duplicate: base.replace(emisor, emisor + emisor),
      unknown: base.replace(receptor, receptor + "<cfdi:Desconocido/>"),
      namespace: base.replace(
        'xmlns:cfdi="http://www.sat.gob.mx/cfd/4"',
        'xmlns:cfdi="http://www.sat.gob.mx/cfd/3"',
      ),
      addenda: base.replace(
        "</cfdi:Comprobante>",
        "<cfdi:Addenda><Proveedor/></cfdi:Addenda></cfdi:Comprobante>",
      ),
      complemento: base.replace(
        "</cfdi:Comprobante>",
        "<cfdi:Complemento><cfdi:Otro/></cfdi:Complemento></cfdi:Comprobante>",
      ),
      malformed: base.slice(0, -20),
    };
    for (const [label, xml] of Object.entries(mutations)) {
      assert.notEqual(xml, base, label);
      samples.set(`mutation-${label}.xml`, xml);
    }

    const directory = mkdtempSync(join(tmpdir(), "orbit-xsd-interop-"));
    try {
      for (const [name, xml] of samples)
        writeFileSync(join(directory, name), xml);
      const run = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve("tests/fixtures/cfdi40/xsd-dotnet.ps1"),
          "-SchemaDir",
          resolve("resources/sat/cfdi40"),
          "-SampleDir",
          directory,
        ],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(run.status, 0, run.stderr);
      const dotnetVerdicts = new Map(
        run.stdout
          .trim()
          .split(/\r?\n/)
          .map((line) => {
            const [verdict, name] = line.trim().split(" ");
            return [name, verdict] as const;
          }),
      );
      const summary = { VALID: 0, INVALID: 0 };
      for (const [name, xml] of samples) {
        const orbit =
          xsd.validate(new Uint8Array(Buffer.from(xml, "utf8"))).length === 0
            ? "VALID"
            : "INVALID";
        assert.equal(dotnetVerdicts.get(name), orbit, name);
        summary[orbit]++;
      }
      // 10 ORBIT + 4 PAC CFDI without complements are valid; complements, addenda, the CFDI
      // without seal attributes and every mutation are not.
      assert.deepEqual(summary, { VALID: 14, INVALID: 11 + 14 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
