import assert from "node:assert/strict";
import { before, test } from "node:test";
import { X509Certificate, randomBytes } from "node:crypto";
import { buildPreSealCfdi40 } from "../src/lib/cfdi40/build";
import { loadCfdi40Catalogs } from "../src/lib/cfdi40/catalogs";
import {
  compileCfdi40Xslt,
  generateCfdi40OriginalString,
} from "../src/lib/cfdi40/original-string";
import { createSealedCfdi40 } from "../src/lib/cfdi40/sealed";
import { cfdi40XsltEngine } from "../src/lib/cfdi40/xslt-engine";
import { loadCfdi40XsltBundle } from "../src/lib/cfdi40/xslt-resources";
import { sealPrivateKey } from "../src/lib/csd/envelope";
import { envKeyProvider } from "../src/lib/csd/key-provider";
import { signWithCustodiedKey } from "../src/lib/csd/signing";
import { issuedAt, validFixtures } from "./fixtures/cfdi40";
import {
  dotnetSignAndVerify,
  dotnetVersion,
  opensslSignAndVerify,
  opensslVersion,
} from "./fixtures/cfdi40/seal-interop.mjs";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.6: ORBIT's seal, produced through the custodied-key path, cross-checked with
// independent implementations on a fresh SYNTHETIC key: the OpenSSL command line and
// Microsoft .NET CNG must produce the very same bytes (PKCS#1 v1.5 is deterministic) and
// verify ORBIT's Sello as PKCS#1 v1.5, never as PSS. Test tooling only (child processes in
// tests, never in ORBIT's runtime). Each tool is skipped, with the reason, when absent.

const openssl = opensslVersion();
const dotnet = dotnetVersion();
const names = Object.keys(validFixtures) as (keyof typeof validFixtures)[];
const authority = syntheticAuthority();
const csd = syntheticCsd(authority, {
  certificateNumber: "30001000000000000001",
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2036-01-01T00:00:00Z"),
});
const certificate = Buffer.from(csd.certificate);
const pkcs8 = () =>
  csd.keyObject.export({ type: "pkcs8", format: "der" }) as Buffer;

const cadenas: Buffer[] = [];
const sellos: Buffer[] = [];

before(async () => {
  const catalogs = await loadCfdi40Catalogs();
  const bundle = await loadCfdi40XsltBundle();
  const stylesheet = compileCfdi40Xslt(cfdi40XsltEngine, bundle);
  const provider = envKeyProvider({
    CSD_KEK_ID: "orbit-seal-interop",
    CSD_KEK_CURRENT_VERSION: "1",
    CSD_KEK_V1: randomBytes(32).toString("base64"),
  });
  const context = {
    organizationId: "org-interop",
    csdCertificateId: "0c9e8f2a-5b4d-4c3e-8a1f-2d3c4b5a6f70",
    certificateSha256: "b".repeat(64),
    environment: "SANDBOX" as const,
  };
  const envelope = await sealPrivateKey(provider, context, pkcs8());
  const binding = {
    noCertificado: "30001000000000000001",
    certificadoBase64: certificate.toString("base64"),
  };
  for (const name of names) {
    const xml = buildPreSealCfdi40(validFixtures[name].invoice(), {
      issuedAt,
      catalogs,
      certificate: binding,
    }).xml;
    const cadena = generateCfdi40OriginalString(xml, {
      engine: cfdi40XsltEngine,
      bundle,
    });
    const signature = await signWithCustodiedKey(
      provider,
      context,
      envelope,
      new X509Certificate(certificate),
      cadena.bytes,
    );
    // Only a verified Sello becomes a sealed CFDI.
    createSealedCfdi40(xml, cadena, signature.toString("base64"), stylesheet);
    cadenas.push(Buffer.from(cadena.bytes));
    sellos.push(signature);
  }
});

test(
  "OpenSSL command line: same Sello bytes as ORBIT, verifies as PKCS#1 v1.5 and not as PSS",
  { skip: openssl ? false : "openssl is not installed on this machine" },
  () => {
    const results = opensslSignAndVerify(pkcs8(), certificate, cadenas, sellos);
    assert.equal(results.length, names.length);
    for (const [index, result] of results.entries()) {
      assert.equal(
        result.signature,
        sellos[index].toString("base64"),
        names[index],
      );
      assert.equal(result.verifiesPkcs1, true, names[index]);
      assert.equal(result.verifiesPss, false, names[index]);
    }
  },
);

test(
  ".NET CNG (RSACng, Pkcs1): same Sello bytes as ORBIT, verifies as PKCS#1 v1.5 and not as PSS",
  { skip: dotnet ? false : "Windows PowerShell/.NET Framework not available" },
  () => {
    const results = dotnetSignAndVerify(
      pkcs8(),
      certificate,
      cadenas,
      sellos,
    ) as {
      signature: string;
      verifiesPkcs1: boolean;
      verifiesPss: boolean;
    }[];
    assert.equal(results.length, names.length);
    for (const [index, result] of results.entries()) {
      assert.equal(
        result.signature,
        sellos[index].toString("base64"),
        names[index],
      );
      assert.equal(result.verifiesPkcs1, true, names[index]);
      assert.equal(result.verifiesPss, false, names[index]);
    }
  },
);
