import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  X509Certificate,
  constants,
  createHash,
  generateKeyPairSync,
  publicDecrypt,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPreSealCfdi40 } from "../src/lib/cfdi40/build";
import {
  loadCfdi40Catalogs,
  type Cfdi40Catalogs,
} from "../src/lib/cfdi40/catalogs";
import { Cfdi40Error } from "../src/lib/cfdi40/errors";
import {
  compileCfdi40Xslt,
  generateCfdi40OriginalString,
  type Cfdi40CompiledXslt,
} from "../src/lib/cfdi40/original-string";
import {
  isXsdValidatedCfdi40,
  pacSubmission,
  type Cfdi40PacSubmission,
} from "../src/lib/cfdi40/schema";
import {
  createSealedCfdi40,
  isSealedCfdi40,
  sealedCfdi40XmlProblems,
} from "../src/lib/cfdi40/sealed";
import { validateOfficialSealedCfdi40Xsd } from "../src/lib/cfdi40/xsd-engine";
import { serializeSealedCfdi40 } from "../src/lib/cfdi40/serialize";
import { cfdi40XsltEngine } from "../src/lib/cfdi40/xslt-engine";
import {
  loadCfdi40XsltBundle,
  type Cfdi40XsltBundle,
} from "../src/lib/cfdi40/xslt-resources";
import type {
  Cfdi40CertificateBinding,
  Cfdi40OriginalString,
  PreSealCfdi40Xml,
  SealedCfdi40Xml,
  UnsignedCfdi40Xml,
} from "../src/lib/cfdi40/types";
import {
  openPrivateKey,
  sealPrivateKey,
  type EnvelopeContext,
} from "../src/lib/csd/envelope";
import { certificateNumberFromSerial } from "../src/lib/csd/certificate-number";
import {
  envKeyProvider,
  type CsdKeyProvider,
} from "../src/lib/csd/key-provider";
import {
  pendingProductionSigningGates,
  productionSigningGates,
} from "../src/lib/csd/production-gates";
import {
  CsdSigningError,
  cfdiSealAlgorithm,
  signCfdiSeal,
  signWithCustodiedKey,
  verifyCfdiSeal,
} from "../src/lib/csd/signing";
import { issuedAt, validFixtures } from "./fixtures/cfdi40";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.6: the CFDI seal without a database. Keys and certificates are SYNTHETIC
// (synthetic CA, generated here); nothing proves SAT validity. Evidence used:
// - the cadenas are the DUAL_ENGINE references of Fase 5C.5 (same NoCertificado);
// - tests/fixtures/cfdi40/seal: sellos made by the OpenSSL command line (and matched by
//   .NET CNG) over those cadenas, accepted here without external tools;
// - CFDI of the PAC sealed with the SAT test CSD verify with ORBIT's verifier, and the ones
//   edited after sealing do not.

const cadenaFixtures = "tests/fixtures/cfdi40/cadena";
const sealFixtures = "tests/fixtures/cfdi40/seal";
const names = Object.keys(validFixtures) as (keyof typeof validFixtures)[];
const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const digestInfoSha256 = "3031300d060960864801650304020105000420";
const bom = String.fromCharCode(0xfeff);

const authority = syntheticAuthority();
const validity = {
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2036-01-01T00:00:00Z"),
};
const csd = syntheticCsd(authority, {
  certificateNumber: "30001000000000000001",
  ...validity,
});
const other = syntheticCsd(authority, {
  certificateNumber: "30001000000000000001",
  ...validity,
});
const bindingOf = (der: Uint8Array): Cfdi40CertificateBinding => ({
  noCertificado: certificateNumberFromSerial(
    new X509Certificate(der).serialNumber,
  )!,
  certificadoBase64: Buffer.from(der).toString("base64"),
});
const binding = bindingOf(csd.certificate);
const certificate = new X509Certificate(csd.certificate);

let catalogs: Cfdi40Catalogs;
let bundle: Cfdi40XsltBundle;
let stylesheet: Cfdi40CompiledXslt;
const references = new Map<string, string>();

before(async () => {
  catalogs = await loadCfdi40Catalogs();
  bundle = await loadCfdi40XsltBundle();
  stylesheet = compileCfdi40Xslt(cfdi40XsltEngine, bundle);
  for (const name of names)
    references.set(
      name,
      await readFile(
        join(cadenaFixtures, "orbit", name + ".cadena.txt"),
        "utf8",
      ),
    );
});

const preSeal = (
  name: keyof typeof validFixtures,
  certificateBinding = binding,
): PreSealCfdi40Xml =>
  buildPreSealCfdi40(validFixtures[name].invoice(), {
    issuedAt,
    catalogs,
    certificate: certificateBinding,
  }).xml;
const cadenaOf = (xml: PreSealCfdi40Xml) =>
  generateCfdi40OriginalString(xml, { engine: cfdi40XsltEngine, bundle });
function seal(
  name: keyof typeof validFixtures,
  key: KeyObject = csd.keyObject,
) {
  const xml = preSeal(name);
  const cadena = cadenaOf(xml);
  const sello = signCfdiSeal(key, cadena.bytes).toString("base64");
  return {
    preSeal: xml,
    cadena,
    sello,
    sealed: createSealedCfdi40(xml, cadena, sello, stylesheet),
  };
}
const codeOf = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    if (error instanceof Cfdi40Error) return error.issues[0].code;
    if (error instanceof CsdSigningError) return error.reason;
    return "OTHER_ERROR";
  }
  return "NO_ERROR";
};

// --- Algorithm ----------------------------------------------------------------------------

test("the seal is RSA with SHA-256 and explicit PKCS#1 v1.5 padding (RSA_PKCS1_PADDING), never PSS", () => {
  assert.deepEqual(
    { ...cfdiSealAlgorithm },
    {
      name: "RSA-SHA256 PKCS#1 v1.5",
      hash: "sha256",
      padding: constants.RSA_PKCS1_PADDING,
    },
  );
  assert.notEqual(cfdiSealAlgorithm.padding, constants.RSA_PKCS1_PSS_PADDING);
  const message = Buffer.from(
    references.get("ingreso-unicode-escape")!,
    "utf8",
  );
  const signature = signCfdiSeal(csd.keyObject, message);
  // 2048-bit modulus: 256 bytes, deterministic (PSS would add a random salt).
  assert.equal(signature.length, 256);
  assert.deepEqual(signCfdiSeal(csd.keyObject, message), signature);
  // EMSA-PKCS1-v1_5 (RFC 8017 §9.2): the RSA public operation recovers DigestInfo(SHA-256).
  assert.equal(
    publicDecrypt(
      { key: certificate.publicKey, padding: constants.RSA_PKCS1_PADDING },
      signature,
    ).toString("hex"),
    digestInfoSha256 + sha256(message),
  );
  assert(verifyCfdiSeal(certificate.publicKey, message, signature));
  assert(
    !verify(
      "sha256",
      message,
      {
        key: certificate.publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
      },
      signature,
    ),
    "a PKCS#1 v1.5 seal is not a PSS signature",
  );
  const pss = sign("sha256", message, {
    key: csd.keyObject,
    padding: constants.RSA_PKCS1_PSS_PADDING,
  });
  assert(!verifyCfdiSeal(certificate.publicKey, message, pss), "PSS refused");
  // An RSA-PSS key can never produce a CFDI seal.
  const pssKey = generateKeyPairSync("rsa-pss", { modulusLength: 2048 });
  assert.equal(
    codeOf(() => signCfdiSeal(pssKey.privateKey, message)),
    "MISMATCH",
  );
  assert(!verifyCfdiSeal(pssKey.publicKey, message, signature));
  // Wrong length, empty, EC key, another message: never verified, never thrown.
  assert(
    !verifyCfdiSeal(certificate.publicKey, message, signature.subarray(1)),
  );
  assert(!verifyCfdiSeal(certificate.publicKey, message, Buffer.alloc(0)));
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
  assert(!verifyCfdiSeal(ec.publicKey, message, signature));
  assert(
    !verifyCfdiSeal(
      certificate.publicKey,
      Buffer.from(message + " "),
      signature,
    ),
  );
  // Larger keys: the Sello is as long as the modulus.
  const large = generateKeyPairSync("rsa", { modulusLength: 4096 });
  const long = signCfdiSeal(large.privateKey, message);
  assert.equal(long.length, 512);
  assert(verifyCfdiSeal(large.publicKey, message, long));
});

// --- Sealed XML ---------------------------------------------------------------------------

test("ten ORBIT invoices sealed: Sello in its cfdv40.xsd position, nothing recomputed, verifiable", async () => {
  // PUE, PPD, IVA 16 %, exento, descuento, varios conceptos, persona física, retenciones,
  // receptor genérico, Unicode/escapes and USD with exchange rate.
  assert.equal(names.length, 10);
  for (const name of names) {
    const { preSeal: xml, cadena, sello, sealed } = seal(name);
    assert.equal(cadena.value, references.get(name), name);
    assert(isSealedCfdi40(sealed), name);
    assert.equal(sealed.stage, "SEALED");
    assert.equal(sealed.preSealSha256, xml.sha256);
    assert.equal(sealed.originalStringSha256, cadena.sha256);
    assert.deepEqual(sealed.certificate, xml.certificate);
    assert.equal(sha256(sealed.bytes), sealed.sha256);
    // Canonical Base64 of 256 bytes: no spaces, line breaks, prefix or PEM.
    assert.match(sello, /^[A-Za-z0-9+/]{342}==$/);
    const at = (attribute: string) => sealed.xml.indexOf(` ${attribute}="`);
    assert(
      at("Fecha") < at("Sello") &&
        at("Sello") < at("FormaPago") &&
        at("FormaPago") < at("NoCertificado") &&
        at("NoCertificado") < at("Certificado"),
      name,
    );
    // The pre-seal bytes with exactly one attribute added.
    assert.equal(sealed.xml.replace(` Sello="${sello}"`, ""), xml.xml, name);
    assert.deepEqual(
      sealedCfdi40XmlProblems(sealed.xml, stylesheet, binding),
      [],
    );
    // Deterministic: the same pre-seal XML and key give the same sealed bytes.
    assert.equal(seal(name).sealed.xml, sealed.xml, name);
    // Sealed is not enough for a PAC (Fase 5C.7): it must pass the official XSD first.
    assert.equal(
      codeOf(() => pacSubmission(sealed)),
      "XSD_VALIDATED_CFDI_REQUIRED",
    );
    const validated = await validateOfficialSealedCfdi40Xsd(sealed);
    assert(isXsdValidatedCfdi40(validated));
    assert.equal(validated.sha256, sealed.sha256);
    assert.equal(pacSubmission(validated).cfdi, validated);
  }
});

test("independent vector: sellos made by the OpenSSL command line are accepted and their sealed XML verifies", async () => {
  const provenance = JSON.parse(
    await readFile(join(sealFixtures, "provenance.json"), "utf8"),
  ) as {
    certificate: { sha256: string };
    fixtures: { fixture: string; cadenaSha256: string; selloSha256: string }[];
  };
  const der = await readFile(join(sealFixtures, "synthetic-seal-vector.cer"));
  assert.equal(sha256(der), provenance.certificate.sha256);
  const vector = bindingOf(der);
  const publicKey = new X509Certificate(der).publicKey;
  assert.deepEqual(
    provenance.fixtures.map((f) => f.fixture).sort(),
    [...names].sort(),
  );
  for (const { fixture, cadenaSha256, selloSha256 } of provenance.fixtures) {
    const name = fixture as keyof typeof validFixtures;
    const sello = await readFile(
      join(sealFixtures, name + ".sello.txt"),
      "utf8",
    );
    assert.equal(sha256(Buffer.from(sello, "utf8")), selloSha256, name);
    const xml = preSeal(name, vector);
    const cadena = cadenaOf(xml);
    assert.equal(cadena.value, references.get(name), name);
    assert.equal(cadena.sha256, cadenaSha256, name);
    assert(
      verifyCfdiSeal(publicKey, cadena.bytes, Buffer.from(sello, "base64")),
      name,
    );
    const sealed = createSealedCfdi40(xml, cadena, sello, stylesheet);
    assert(isSealedCfdi40(sealed), name);
    assert.deepEqual(
      sealedCfdi40XmlProblems(sealed.xml, stylesheet, vector),
      [],
    );
  }
});

test("PAC test CFDI sealed with the SAT test CSD verify with ORBIT's verifier; the ones edited after sealing do not", async () => {
  const provenance = JSON.parse(
    await readFile(join(cadenaFixtures, "sw", "provenance.json"), "utf8"),
  ) as {
    fixtures: { fixture: string; evidence: "SEAL_VERIFIED" | "DUAL_ENGINE" }[];
  };
  const verdicts = { verified: 0, rejected: 0 };
  for (const { fixture, evidence } of provenance.fixtures) {
    let xml = await readFile(
      join(cadenaFixtures, "sw", fixture + ".xml"),
      "utf8",
    );
    if (xml.startsWith(bom)) xml = xml.slice(1);
    const problems = sealedCfdi40XmlProblems(xml, stylesheet);
    if (evidence === "SEAL_VERIFIED") {
      assert.deepEqual(problems, [], fixture);
      verdicts.verified++;
    } else {
      assert(problems.includes("SELLO_NOT_VERIFIED"), fixture);
      verdicts.rejected++;
    }
  }
  assert.deepEqual(verdicts, { verified: 10, rejected: 5 });
});

test("after sealing, changing any fiscal byte, the certificate or the Sello fails verification", () => {
  const { sealed, sello } = seal("ingreso-multiples-conceptos");
  const xml = sealed.xml;
  assert.deepEqual(sealedCfdi40XmlProblems(xml, stylesheet, binding), []);
  const replaceOnce = (from: string, to: string) => {
    assert(xml.includes(from), from);
    return xml.replace(from, to);
  };
  const otherCertificate = Buffer.from(other.certificate).toString("base64");
  const flipped = (sello[10] === "A" ? "B" : "A") + "";
  const tampered: Record<string, string> = {
    importe: replaceOnce(' SubTotal="3523.82"', ' SubTotal="3523.83"'),
    "importe del concepto": replaceOnce(
      ' Importe="250.50"',
      ' Importe="250.51"',
    ),
    total: replaceOnce(' Total="3289.02"', ' Total="3289.03"'),
    "RFC emisor": replaceOnce(' Rfc="SCA010101AB1"', ' Rfc="SCA010101AB2"'),
    "RFC receptor": replaceOnce(' Rfc="SCB020202CD2"', ' Rfc="SCB020202CD3"'),
    fecha: replaceOnce(
      ' Fecha="2026-10-12T12:30:15"',
      ' Fecha="2026-10-12T12:30:16"',
    ),
    concepto: replaceOnce(
      ' Descripcion="Servicio de facturación sintético"',
      ' Descripcion="Servicio de facturación sintética"',
    ),
    impuesto: replaceOnce(' Importe="464.00"', ' Importe="464.01"'),
    "tasa del impuesto": replaceOnce(
      ' TasaOCuota="0.106667"',
      ' TasaOCuota="0.106668"',
    ),
    NoCertificado: replaceOnce(
      ' NoCertificado="30001000000000000001"',
      ' NoCertificado="30001000000000000002"',
    ),
    Certificado: replaceOnce(
      ` Certificado="${binding.certificadoBase64}"`,
      ` Certificado="${otherCertificate}"`,
    ),
    Sello: replaceOnce(
      ` Sello="${sello}"`,
      ` Sello="${sello.slice(0, 10)}${flipped}${sello.slice(11)}"`,
    ),
  };
  for (const [label, changed] of Object.entries(tampered)) {
    assert.notEqual(changed, xml, label);
    assert(
      sealedCfdi40XmlProblems(changed, stylesheet).includes(
        "SELLO_NOT_VERIFIED",
      ),
      label,
    );
  }
  // One single byte of fiscal content, anywhere in the comprobante after the attributes.
  const fiscal = xml.indexOf("<cfdi:Emisor");
  for (const offset of [12, 120, 400, 900]) {
    const position = xml.indexOf('"', fiscal + offset) + 1;
    const character = xml[position];
    const replacement = /[0-9]/.test(character)
      ? String((Number(character) + 1) % 10)
      : character === "A"
        ? "B"
        : "A";
    const changed =
      xml.slice(0, position) + replacement + xml.slice(position + 1);
    assert(
      sealedCfdi40XmlProblems(changed, stylesheet).includes(
        "SELLO_NOT_VERIFIED",
      ),
      `byte ${position}`,
    );
  }
  // A registered value changed in memory stops being sealed.
  const { sealed: registered } = seal("ingreso-pue-iva16");
  assert(isSealedCfdi40(registered));
  const index = registered.xml.indexOf(' Total="') + 8;
  registered.bytes[index] = registered.bytes[index] === 0x31 ? 0x32 : 0x31;
  assert.equal(isSealedCfdi40(registered), false);
  assert.equal(
    codeOf(() => pacSubmission(registered)),
    "XSD_VALIDATED_CFDI_REQUIRED",
  );
});

test("a sealed CFDI is built only from ORBIT's pre-seal XML, its own cadena and a Sello that verifies", () => {
  const xml = preSeal("ingreso-ppd");
  const cadena = cadenaOf(xml);
  const sello = signCfdiSeal(csd.keyObject, cadena.bytes).toString("base64");
  const create =
    (p: PreSealCfdi40Xml, c: Cfdi40OriginalString, s: string) => () =>
      createSealedCfdi40(p, c, s, stylesheet);
  // Look-alike inputs.
  const forgedPreSeal = { ...xml } as PreSealCfdi40Xml;
  assert.equal(
    codeOf(create(forgedPreSeal, cadena, sello)),
    "PRE_SEAL_CFDI_REQUIRED",
  );
  const forgedCadena = { ...cadena } as Cfdi40OriginalString;
  assert.equal(
    codeOf(create(xml, forgedCadena, sello)),
    "ORIGINAL_STRING_INVALID",
  );
  const otherCadena = cadenaOf(preSeal("ingreso-exento"));
  assert.equal(
    codeOf(create(xml, otherCadena, sello)),
    "ORIGINAL_STRING_INVALID",
  );
  // Sellos that do not verify for this cadena and certificate.
  const message = cadena.bytes;
  const invalid: Record<string, string> = {
    "another key": signCfdiSeal(other.keyObject, message).toString("base64"),
    "another cadena": signCfdiSeal(csd.keyObject, otherCadena.bytes).toString(
      "base64",
    ),
    PSS: sign("sha256", message, {
      key: csd.keyObject,
      padding: constants.RSA_PKCS1_PSS_PADDING,
    }).toString("base64"),
    empty: "",
    placeholder: "A".repeat(344),
    "line breaks": sello.replace(/(.{64})/g, "$1\n"),
    spaces: sello.slice(0, 100) + " " + sello.slice(100),
    PEM: `-----BEGIN SIGNATURE-----${sello}-----END SIGNATURE-----`,
    truncated: sello.slice(0, 340),
  };
  for (const [label, value] of Object.entries(invalid))
    assert.equal(
      codeOf(create(xml, cadena, value)),
      "CFDI_SEAL_VERIFICATION_FAILED",
      label,
    );
  // The XML writer itself accepts canonical Base64 only, and only for ORBIT's pre-seal XML.
  assert.equal(
    codeOf(() => serializeSealedCfdi40(xml, "not base64!")),
    "CFDI_SEAL_FAILED",
  );
  assert.equal(
    codeOf(() => serializeSealedCfdi40(forgedPreSeal, sello)),
    "PRE_SEAL_CFDI_REQUIRED",
  );
  assert(isSealedCfdi40(createSealedCfdi40(xml, cadena, sello, stylesheet)));

  // Types: only XsdValidatedCfdi40 reaches a PAC (Fase 5C.7); no literal can be sealed.
  const sealedValue = createSealedCfdi40(xml, cadena, sello, stylesheet);
  // @ts-expect-error A sealed CFDI that did not pass the XSD cannot be submitted to a PAC.
  const fromSealed: Cfdi40PacSubmission = { cfdi: sealedValue };
  assert.equal(isXsdValidatedCfdi40(fromSealed.cfdi), false);
  const unsigned = { stage: "UNSIGNED" } as UnsignedCfdi40Xml;
  // @ts-expect-error An unsigned XML cannot be submitted to a PAC.
  const fromUnsigned: Cfdi40PacSubmission = { cfdi: unsigned };
  // @ts-expect-error A pre-seal XML cannot be submitted to a PAC.
  const fromPreSeal: Cfdi40PacSubmission = { cfdi: xml };
  // @ts-expect-error A cadena original is not a sealed CFDI.
  const fromCadena: SealedCfdi40Xml = cadena;
  // @ts-expect-error No object literal can carry the sealed brand.
  const literal: SealedCfdi40Xml = {
    stage: "SEALED",
    xml: xml.xml,
    bytes: xml.bytes,
    sha256: xml.sha256,
    certificate: xml.certificate,
    preSealSha256: xml.sha256,
    originalStringSha256: cadena.sha256,
  };
  for (const value of [
    fromUnsigned.cfdi,
    fromPreSeal.cfdi,
    fromCadena,
    literal,
  ])
    assert.equal(isSealedCfdi40(value), false);
});

// --- Custodied key ------------------------------------------------------------------------

const kekEnv = {
  CSD_KEK_ID: "orbit-seal-tests",
  CSD_KEK_CURRENT_VERSION: "1",
  CSD_KEK_V1: randomBytes(32).toString("base64"),
};
/** The env provider, recording each unwrapped DEK so the test can check it is wiped. */
function recordingProvider(base: CsdKeyProvider) {
  const deks: Buffer[] = [];
  const provider: CsdKeyProvider = {
    provider: base.provider,
    availability: () => base.availability(),
    canUnwrap: (ref) => base.canUnwrap(ref),
    wrapDataKey: (dek, aad) => base.wrapDataKey(dek, aad),
    async unwrapDataKey(ref, wrapped, aad) {
      const dek = await base.unwrapDataKey(ref, wrapped, aad);
      deks.push(dek);
      return dek;
    },
  };
  return { provider, deks };
}
const context: EnvelopeContext = {
  organizationId: "org-seal",
  csdCertificateId: "6f1d4c3e-2b8a-4d6f-9e1a-3c5b7d9f1a2b",
  certificateSha256: sha256(csd.certificate),
  environment: "SANDBOX",
};
const pkcs8Of = (key: KeyObject) =>
  key.export({ type: "pkcs8", format: "der" }) as Buffer;

test("the custodied key is opened for each signature, never cached, and its DEK and PKCS#8 are wiped", async () => {
  const base = envKeyProvider(kekEnv);
  const sealedKey = await sealPrivateKey(base, context, pkcs8Of(csd.keyObject));
  const { provider, deks } = recordingProvider(base);
  const opened: Buffer[] = [];
  const open: typeof openPrivateKey = async (...args) => {
    const pkcs8 = await openPrivateKey(...args);
    opened.push(pkcs8);
    return pkcs8;
  };
  const cadena = cadenaOf(preSeal("ingreso-usd-tipo-cambio"));
  const signatures: Buffer[] = [];
  for (let i = 0; i < 3; i++)
    signatures.push(
      await signWithCustodiedKey(
        provider,
        context,
        sealedKey,
        certificate,
        cadena.bytes,
        open,
      ),
    );
  // Opened three times (no cache) and the same deterministic Sello each time, equal to
  // signing with the original key.
  assert.equal(deks.length, 3);
  assert.equal(opened.length, 3);
  for (const signature of signatures)
    assert.deepEqual(signature, signCfdiSeal(csd.keyObject, cadena.bytes));
  for (const buffer of [...deks, ...opened]) {
    assert(buffer.length > 0);
    assert(
      buffer.every((byte) => byte === 0),
      "wiped",
    );
  }

  // Failures: wrong certificate, corrupted envelope, unavailable provider. The PKCS#8 is
  // wiped on failure too.
  opened.length = 0;
  await assert.rejects(
    signWithCustodiedKey(
      provider,
      context,
      sealedKey,
      new X509Certificate(other.certificate),
      cadena.bytes,
      open,
    ),
    (error) => error instanceof CsdSigningError && error.reason === "MISMATCH",
  );
  assert(opened[0].every((byte) => byte === 0));
  const corrupted = {
    ...sealedKey,
    ciphertext: Buffer.from(sealedKey.ciphertext).fill(1, 0, 4),
  };
  await assert.rejects(
    signWithCustodiedKey(
      provider,
      context,
      corrupted,
      certificate,
      cadena.bytes,
    ),
    (error) => error instanceof CsdSigningError && error.reason === "INTEGRITY",
  );
  await assert.rejects(
    signWithCustodiedKey(
      envKeyProvider({
        ...kekEnv,
        CSD_KEK_V1: randomBytes(32).toString("base64"),
      }),
      context,
      sealedKey,
      certificate,
      cadena.bytes,
    ),
    (error) => error instanceof CsdSigningError && error.reason === "INTEGRITY",
  );
  await assert.rejects(
    signWithCustodiedKey(
      envKeyProvider({}),
      context,
      sealedKey,
      certificate,
      cadena.bytes,
    ),
    (error) =>
      error instanceof CsdSigningError && error.reason === "KEY_UNAVAILABLE",
  );
  // The envelope is bound to its context: another Organization cannot open it.
  await assert.rejects(
    signWithCustodiedKey(
      provider,
      { ...context, organizationId: "org-other" },
      sealedKey,
      certificate,
      cadena.bytes,
    ),
    (error) => error instanceof CsdSigningError && error.reason === "INTEGRITY",
  );
});

// --- No network ---------------------------------------------------------------------------

const attempts: string[] = [];
const restore: (() => void)[] = [];
function block<T extends object, K extends keyof T>(
  target: T,
  key: K,
  label: string,
) {
  const original = target[key];
  restore.push(() => {
    target[key] = original;
  });
  target[key] = function () {
    attempts.push(label);
    throw new Error("BLOCKED " + label);
  } as T[K];
}
after(() => {
  for (const undo of restore.reverse()) undo();
});

test("sealing (cadena, unwrap, signature, sealed XML and its verification) makes no network attempt", async () => {
  const base = envKeyProvider(kekEnv);
  const sealedKey = await sealPrivateKey(base, context, pkcs8Of(csd.keyObject));
  block(globalThis, "fetch", "fetch");
  block(net.Socket.prototype, "connect", "net.connect");
  block(dns, "lookup", "dns.lookup");
  // Self-check: the guards really block.
  assert.throws(() => fetch("https://example.test"));
  assert.throws(() => dns.lookup("example.test", () => undefined));
  assert.deepEqual(attempts.splice(0), ["fetch", "dns.lookup"]);
  for (const name of names) {
    const xml = preSeal(name);
    const cadena = cadenaOf(xml);
    const signature = await signWithCustodiedKey(
      base,
      context,
      sealedKey,
      certificate,
      cadena.bytes,
    );
    const sealed = createSealedCfdi40(
      xml,
      cadena,
      signature.toString("base64"),
      stylesheet,
    );
    assert.deepEqual(sealedCfdi40XmlProblems(sealed.xml, stylesheet), []);
  }
  assert.deepEqual(attempts, []);
});

// --- Static review ------------------------------------------------------------------------

test("signing code: no network, files, processes, eval, console, key cache or key in public types", async () => {
  const files = [
    "src/lib/csd/signing.ts",
    "src/lib/csd/decipher.ts",
    "src/lib/cfdi40/sealed.ts",
    "src/services/csd-signing.ts",
  ];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert(
      !/\bfetch\(|XMLHttpRequest|node:(fs|http|https|net|dns|child_process|worker_threads)|from "(fs|http|https|net|child_process)"|\beval\(|new Function|\bconsole\./.test(
        text,
      ),
      file,
    );
    // No module-level store or mutable binding that could keep a key between operations.
    // The only one allowed is sealed.ts's registry of sealed CFDI (no key material).
    const stores =
      text.match(/^(?:const|let|var) \w+ = new (?:Weak)?(?:Map|Set)\b.*$/gm) ??
      [];
    assert.deepEqual(
      stores,
      file === "src/lib/cfdi40/sealed.ts"
        ? ["const registry = new WeakSet<object>();"]
        : [],
      file,
    );
    assert.doesNotMatch(text, /^let /m, file);
  }
  // The signing service exposes the Sello and metadata, never a key object or PKCS#8.
  const service = await readFile("src/services/csd-signing.ts", "utf8");
  assert(!/KeyObject|pkcs8|createPrivateKey/.test(service));
  assert.match(service, /^import "server-only";/);
  assert.doesNotMatch(service, /\bpassword\??\s*:/i, "no password parameter");
});

// --- Production gates ---------------------------------------------------------------------

test("fiscal PRODUCTION signing stays blocked: the remaining evidence gates are pending and none is waived", () => {
  // Changing any of these needs the evidence in docs/tasks/FASE5C6-CSD-SIGNING.md §10 and
  // explicit authorization; this test fails on purpose when one changes.
  // OFFICIAL_CSD_FIXTURE_VALIDATED: official SAT test CSD + live SW sandbox stamp (FASE5C8 §21).
  assert.deepEqual(
    { ...productionSigningGates },
    {
      CSD_TYPE_VERIFIED: false,
      OFFICIAL_CSD_FIXTURE_VALIDATED: true,
      POSTGRES_CSD_CONCURRENCY_VALIDATED: false,
    },
  );
  assert(Object.isFrozen(productionSigningGates));
  assert.deepEqual(pendingProductionSigningGates(), [
    "CSD_TYPE_VERIFIED",
    "POSTGRES_CSD_CONCURRENCY_VALIDATED",
  ]);
  // Only all three together clear this part of the gate (KMS/HSM and the Legal gate are
  // separate requirements).
  assert.deepEqual(
    pendingProductionSigningGates({
      CSD_TYPE_VERIFIED: true,
      OFFICIAL_CSD_FIXTURE_VALIDATED: true,
      POSTGRES_CSD_CONCURRENCY_VALIDATED: false,
    }),
    ["POSTGRES_CSD_CONCURRENCY_VALIDATED"],
  );
});
