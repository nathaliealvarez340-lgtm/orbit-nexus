import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  X509Certificate,
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  certificateNumberFromSerial,
  certificateRfc,
  parseCertificate,
} from "../src/lib/csd/certificate";
import {
  fiscalEnvironment,
  isRecentSignIn,
  productionLegalGateSatisfied,
  reauthWindowSeconds,
  resolveCustody,
} from "../src/lib/csd/custody";
import { csdCustodyTerms } from "../src/lib/csd/custody-terms";
import {
  DerError,
  certificateSubject,
  children,
  encryptedPrivateKeyInfo,
  readDocument,
} from "../src/lib/csd/der";
import {
  EnvelopeError,
  openPrivateKey,
  rewrapPrivateKey,
  sealPrivateKey,
  type EnvelopeContext,
  type SealedPrivateKey,
} from "../src/lib/csd/envelope";
import {
  CsdError,
  csdApiError,
  csdErrorCodes,
  csdErrorStatus,
} from "../src/lib/csd/errors";
import { envKeyProvider, keyProviderFor } from "../src/lib/csd/key-provider";
import {
  e2eHarnessEnabled,
  e2eHarnessFlag,
  officialTestAuthorities,
  testAuthorities,
} from "../src/lib/csd/test-authorities";
import { validateCsdUpload, type CsdUpload } from "../src/lib/csd/validate";
import { sanitizeAuditMetadata } from "../src/lib/audit";
import { analyticsPath } from "../src/lib/analytics-policy";
import { redact, redactText } from "../src/lib/security/redact";
import {
  der,
  sequence,
  syntheticAuthority,
  syntheticCsd,
  syntheticPassword,
} from "./fixtures/synthetic-csd.mjs";

// Fase 5C.3 §AC (unit). Certificates are SYNTHETIC, generated here and signed by a
// synthetic CA: they test ORBIT's checks, NOT SAT validity (§M.7/§M.8 remain hypotheses
// until verified with official test CSD).

const authority = syntheticAuthority();
const authorityX509 = new X509Certificate(authority.certificate);
const csd = syntheticCsd(authority);
const now = new Date();
const kek = () => randomBytes(32).toString("base64");
const sandboxEnv = (extra: Record<string, string> = {}) => ({
  CSD_KEY_PROVIDER_SANDBOX: "env",
  CSD_KEK_ID: "orbit-csd-test",
  CSD_KEK_CURRENT_VERSION: "1",
  CSD_KEK_V1: kek(),
  ...extra,
});

type CsdMaterial = {
  certificate: Uint8Array;
  privateKey: Uint8Array;
  password: string;
};
function upload(
  material: CsdMaterial = csd,
  overrides: Partial<CsdUpload> = {},
): CsdUpload {
  return {
    certificate: {
      name: "certificado.cer",
      bytes: Buffer.from(material.certificate),
    },
    privateKey: { name: "llave.KEY", bytes: Buffer.from(material.privateKey) },
    password: material.password,
    custodyTermsVersion: csdCustodyTerms.version,
    accepted: true,
    ...overrides,
  };
}
const options = {
  profileRfc: "SCA010101AB1",
  environment: "SANDBOX" as const,
  authorities: [authorityX509],
  now,
};
const openSslText = /error:|ossl|openssl|decrypt|asn1|provider routines|bad /i;

function rejects(run: () => unknown, code: string, stage?: number | string) {
  assert.throws(run, (error: unknown) => {
    assert(error instanceof CsdError, "expected CsdError");
    assert.equal(error.code, code);
    if (stage !== undefined) assert.equal(error.stage, stage);
    assert(
      !openSslText.test(error.message),
      "no OpenSSL text: " + error.message,
    );
    return true;
  });
}

// --- DER reader ---------------------------------------------------------------------

test("DER reader accepts strict DER only and reads the subject", () => {
  assert.throws(() => readDocument(Buffer.from([0x30, 0x80, 0, 0])), DerError);
  assert.throws(
    () => readDocument(Buffer.from([0x30, 0x81, 0x01, 0x05])),
    DerError,
  );
  assert.throws(
    () => readDocument(Buffer.concat([sequence(), Buffer.from([0])])),
    DerError,
  );
  assert.throws(() => readDocument(Buffer.from([0x30, 0x05, 0x01])), DerError);
  const subject = certificateSubject(csd.certificate);
  assert.deepEqual(
    subject.find((a) => a.oid === "2.5.4.45"),
    { oid: "2.5.4.45", value: "SCA010101AB1 / XAXX010101000" },
  );
  const structure = encryptedPrivateKeyInfo(csd.privateKey);
  assert.equal(structure.scheme, "1.2.840.113549.1.5.13");
  assert.equal(structure.kdf, "1.2.840.113549.1.5.12");
  assert.equal(structure.cipher, "1.2.840.113549.3.7");
});

// --- Certificate (§M.5–8) -----------------------------------------------------------

test("certificate parsing: DER X.509 end-entity RSA ≥ 2048 only", () => {
  const { info } = parseCertificate(Buffer.from(csd.certificate));
  assert.equal(info.publicKeyBits, 2048);
  assert.equal(info.publicKeyAlgorithm, "RSA");
  assert.equal(info.signatureAlgorithm, "sha256WithRSAEncryption");
  assert.match(info.sha256, /^[0-9a-f]{64}$/);
  assert(info.validFrom < now && now < info.validTo);
  const pem = new X509Certificate(csd.certificate).toString();
  rejects(
    () => parseCertificate(Buffer.from(pem)),
    "CSD_CERTIFICATE_INVALID",
    5,
  );
  rejects(
    () => parseCertificate(Buffer.from(String.fromCharCode(0xfeff) + pem)),
    "CSD_CERTIFICATE_INVALID",
  );
  rejects(
    () => parseCertificate(Buffer.from(authority.certificate)),
    "CSD_CERTIFICATE_INVALID",
    5,
  );
  rejects(
    () => parseCertificate(randomBytes(400)),
    "CSD_CERTIFICATE_INVALID",
    5,
  );
  rejects(
    () => parseCertificate(Buffer.concat([csd.certificate, Buffer.from([0])])),
    "CSD_CERTIFICATE_INVALID",
    5,
  );
  rejects(
    () =>
      parseCertificate(
        Buffer.from(
          syntheticCsd(authority, { modulusLength: 1024 }).certificate,
        ),
      ),
    "CSD_UNSUPPORTED",
    5,
  );
  rejects(
    () =>
      parseCertificate(
        Buffer.from(syntheticCsd(authority, { keyType: "ec" }).certificate),
      ),
    "CSD_UNSUPPORTED",
    5,
  );
});

test("RFC hypothesis (§M.7): single x500UniqueIdentifier, first token, strict format", () => {
  assert.equal(certificateRfc(csd.certificate), "SCA010101AB1");
  const individual = syntheticCsd(authority, { subjectRfc: "XAXX010101000" });
  assert.equal(certificateRfc(individual.certificate), "XAXX010101000");
  for (const subjectRfc of [
    null,
    "",
    "NO ES UN RFC",
    " / SCA010101AB1",
    "sca010101ab1",
  ])
    assert.equal(
      certificateRfc(syntheticCsd(authority, { subjectRfc }).certificate),
      null,
      String(subjectRfc),
    );
  rejects(
    () =>
      validateCsdUpload(upload(), { ...options, profileRfc: "XAXX010101000" }),
    "CSD_RFC_MISMATCH",
    7,
  );
  const missing = syntheticCsd(authority, { subjectRfc: null });
  rejects(
    () => validateCsdUpload(upload(missing), options),
    "CSD_RFC_UNVERIFIABLE",
    7,
  );
  // The Fiscal Profile value is compared normalized.
  assert.equal(
    validateCsdUpload(upload(), { ...options, profileRfc: " sca010101ab1 " })
      .certificate.rfc,
    "SCA010101AB1",
  );
});

test("NoCertificado hypothesis (§M.8): 20 ASCII digits in the serial number", () => {
  assert.equal(
    certificateNumberFromSerial(
      Buffer.from("30001000000500003416").toString("hex"),
    ),
    "30001000000500003416",
  );
  assert.equal(certificateNumberFromSerial("0102"), null);
  assert.equal(
    certificateNumberFromSerial(
      Buffer.from("3000100000050000341").toString("hex"),
    ),
    null,
  );
  assert.equal(
    certificateNumberFromSerial(
      Buffer.from("3000100000050000341A").toString("hex"),
    ),
    null,
  );
  const result = validateCsdUpload(upload(), options);
  assert.equal(result.certificate.certificateNumber, csd.certificateNumber);
  result.pkcs8.fill(0);
  const random = syntheticCsd(authority, {
    serial: Buffer.from([0x12, 0x34, 0x56]),
  });
  rejects(
    () => validateCsdUpload(upload(random), options),
    "CSD_UNSUPPORTED",
    8,
  );
});

test("validity window: expired and not yet valid certificates are rejected", () => {
  const day = 24 * 3600 * 1000;
  const expired = syntheticCsd(authority, {
    validFrom: new Date(now.getTime() - 400 * day),
    validTo: new Date(now.getTime() - day),
  });
  rejects(() => validateCsdUpload(upload(expired), options), "CSD_EXPIRED", 6);
  const future = syntheticCsd(authority, {
    validFrom: new Date(now.getTime() + day),
    validTo: new Date(now.getTime() + 400 * day),
  });
  rejects(
    () => validateCsdUpload(upload(future), options),
    "CSD_NOT_YET_VALID",
    6,
  );
});

// --- Upload, test CA and key (§M.3–4, 8b, 9–13) -------------------------------------

test("upload checks: files, password, custody terms, size and extension", () => {
  rejects(
    () => validateCsdUpload(upload(csd, { certificate: null }), options),
    "CSD_FILES_REQUIRED",
    3,
  );
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, {
          privateKey: { name: "llave.key", bytes: Buffer.alloc(0) },
        }),
        options,
      ),
    "CSD_FILES_REQUIRED",
    3,
  );
  rejects(
    () => validateCsdUpload(upload(csd, { password: "" }), options),
    "CSD_FILES_REQUIRED",
    3,
  );
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, { password: syntheticPassword().padEnd(257, "x") }),
        options,
      ),
    "CSD_PASSWORD_INVALID",
    3,
  );
  rejects(
    () => validateCsdUpload(upload(csd, { accepted: false }), options),
    "CSD_CUSTODY_TERMS_REQUIRED",
    3,
  );
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, { custodyTermsVersion: "otra-version" }),
        options,
      ),
    "CSD_CUSTODY_TERMS_REQUIRED",
    3,
  );
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, {
          certificate: { name: "a.cer", bytes: Buffer.alloc(16 * 1024 + 1, 1) },
        }),
        options,
      ),
    "CSD_FILE_TOO_LARGE",
    4,
  );
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, {
          certificate: {
            name: "certificado.pem",
            bytes: Buffer.from(csd.certificate),
          },
        }),
        options,
      ),
    "CSD_CERTIFICATE_INVALID",
    4,
  );
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, {
          privateKey: { name: "llave.txt", bytes: Buffer.from(csd.privateKey) },
        }),
        options,
      ),
    "CSD_KEY_INVALID",
    4,
  );
});

// Official SAT test CA "AC UAT" (2022), the only entry of the official allowlist.
const acUatSha256 =
  "ff9c220344614c06fa483b846d7959f9ba0806dfa85610f4ace3b2df8aefacf9";
const officialCas = testAuthorities({});
const fingerprint = (certificate: X509Certificate) =>
  certificate.fingerprint256.replace(/:/g, "").toLowerCase();
/** DER of the subject Name of a certificate, byte for byte. */
function rawSubject(certificate: Buffer) {
  const [tbs] = children(certificate, readDocument(certificate));
  const fields = children(certificate, tbs);
  const subject = fields[(fields[0].tag === 0xa0 ? 1 : 0) + 4];
  return certificate.subarray(subject.start, subject.end);
}

test("§M.0: SANDBOX accepts only certificates signed by an allowlisted test CA", () => {
  const other = syntheticAuthority("OTRA AC SINTETICA");
  const foreign = syntheticCsd(other);
  rejects(
    () => validateCsdUpload(upload(foreign), options),
    "CSD_ENVIRONMENT_MISMATCH",
    "8b",
  );
  // Same issuer name but a different key: name matching alone is never enough.
  const impostor = syntheticAuthority("AC SINTETICA DE PRUEBAS");
  rejects(
    () => validateCsdUpload(upload(syntheticCsd(impostor)), options),
    "CSD_ENVIRONMENT_MISMATCH",
    "8b",
  );
  rejects(
    () => validateCsdUpload(upload(), { ...options, authorities: [] }),
    "CSD_ENVIRONMENT_MISMATCH",
    "8b",
  );
  // A demonstrated test certificate is never accepted for fiscal PRODUCTION.
  rejects(
    () =>
      validateCsdUpload(upload(), { ...options, environment: "PRODUCTION" }),
    "CSD_ENVIRONMENT_MISMATCH",
    "8b",
  );
  // The official allowlist never makes a synthetic certificate a test certificate.
  rejects(
    () =>
      validateCsdUpload(upload(), { ...options, authorities: officialCas }),
    "CSD_ENVIRONMENT_MISMATCH",
    "8b",
  );
});

test("§M.0 official allowlist: only the pinned SAT test CA AC UAT, a CA, never a CSD", () => {
  assert.equal(officialTestAuthorities.length, 1);
  const [entry] = officialTestAuthorities;
  assert.equal(entry.sha256, acUatSha256);
  assert.match(entry.sourceUrl, /^https?:\/\/omawww\.sat\.gob\.mx\//);
  assert.match(entry.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(officialCas.length, 1);
  const [ca] = officialCas;
  assert.equal(fingerprint(ca), acUatSha256);
  assert.equal(ca.ca, true);
  assert.equal(ca.subject, entry.subject);
  assert.match(ca.subject, /^CN=AC UAT\nO=SERVICIO DE ADMINISTRACION TRIBUTARIA/);
  assert.equal(ca.serialNumber.toUpperCase(), entry.serialNumberHex);
  assert.equal(ca.publicKey.asymmetricKeyDetails?.modulusLength, 4096);
  assert.equal(ca.verify(ca.publicKey), false, "an intermediate, not a root");
  // The official entry does not depend on the E2E harness or on NODE_ENV.
  assert.deepEqual(testAuthorities({ NODE_ENV: "production" }).map(fingerprint), [
    acUatSha256,
  ]);
});

test("§M.0 impostor CA with exactly the AC UAT subject and another key is rejected", () => {
  const subject = rawSubject(Buffer.from(officialCas[0].raw));
  const impostor = syntheticAuthority("AC UAT IMPOSTOR", { rawSubject: subject });
  const impostorX509 = new X509Certificate(impostor.certificate);
  assert.equal(impostorX509.subject, officialCas[0].subject);
  assert.equal(impostorX509.ca, true);
  const forged = syntheticCsd(impostor);
  const forgedX509 = new X509Certificate(forged.certificate);
  // Same issuer name as the official CA: the name matches, the signature does not.
  assert.equal(forgedX509.checkIssued(officialCas[0]), true);
  assert.equal(forgedX509.verify(officialCas[0].publicKey), false);
  rejects(
    () =>
      validateCsdUpload(upload(forged), { ...options, authorities: officialCas }),
    "CSD_ENVIRONMENT_MISMATCH",
    "8b",
  );
  // A test CA, even one with the official subject, never makes a certificate PRODUCTION.
  rejects(
    () =>
      validateCsdUpload(upload(forged), {
        ...options,
        authorities: [...officialCas, impostorX509],
        environment: "PRODUCTION",
      }),
    "CSD_ENVIRONMENT_MISMATCH",
    "8b",
  );
});

// SW sandbox / SAT official TEST CSD (2023-05-18 batch, issued by AC UAT 2022), read from the
// paths in these variables only when they are present (never copied to the repository).
// Without them this test is skipped and says so. The expected facts are pinned per
// certificate SHA-256; any other certificate fails instead of being trusted.
const officialCsdPresent = Boolean(
  process.env.SW_TEST_CSD_CER &&
    process.env.SW_TEST_CSD_KEY &&
    process.env.SW_TEST_CSD_PASSWORD,
);
const officialTestCsds: Record<
  string,
  { rfc: string; certificateNumber: string; validFrom: string; validTo: string }
> = {
  // KIJ0906199R1 (Sucursal 1).
  "90561071e99cc75321bb1dfdebc847e5e80473e1539e7f8a4297b5d0de870545": {
    rfc: "KIJ0906199R1",
    certificateNumber: "30001000000500003437",
    validFrom: "2023-05-18T12:52:53Z",
    validTo: "2027-05-18T12:52:53Z",
  },
  // EKU9003173C9 (ESCUELA KEMPER URGATE, Sucursal 1): stamped live in the SW sandbox (5C.8).
  "92be3ef448e0fd01467f3b0cbd8e77b568d84ea58f22f5afa400b2ec99bbbb53": {
    rfc: "EKU9003173C9",
    certificateNumber: "30001000000500003416",
    validFrom: "2023-05-18T11:43:51Z",
    validTo: "2027-05-18T11:43:51Z",
  },
};
test(
  "§M.0 official SAT test CSD (KIJ0906199R1 or EKU9003173C9): accepted in SANDBOX, rejected in PRODUCTION and outside its validity",
  {
    skip: officialCsdPresent
      ? false
      : "SW_TEST_CSD_CER/SW_TEST_CSD_KEY/SW_TEST_CSD_PASSWORD not set",
  },
  () => {
    const official = {
      certificate: readFileSync(process.env.SW_TEST_CSD_CER!),
      privateKey: readFileSync(process.env.SW_TEST_CSD_KEY!),
      password: process.env.SW_TEST_CSD_PASSWORD!,
    };
    const certificateSha256 = createHash("sha256")
      .update(official.certificate)
      .digest("hex");
    const expected = officialTestCsds[certificateSha256];
    assert(expected, "not a known official SAT test CSD");
    const officialOptions = {
      profileRfc: expected.rfc,
      environment: "SANDBOX" as const,
      authorities: officialCas,
      now: new Date("2026-10-21T12:00:00Z"),
    };
    const result = validateCsdUpload(upload(official), officialOptions);
    try {
      // §M.7 RFC from x500UniqueIdentifier; §M.8 NoCertificado from the ASCII serial.
      assert.equal(result.certificate.rfc, expected.rfc);
      assert.equal(
        result.certificate.certificateNumber,
        expected.certificateNumber,
      );
      assert.equal(result.certificate.publicKeyBits, 2048);
      assert.equal(result.certificate.sha256, certificateSha256);
    } finally {
      result.pkcs8.fill(0);
    }
    rejects(
      () =>
        validateCsdUpload(upload(official), {
          ...officialOptions,
          environment: "PRODUCTION",
        }),
      "CSD_ENVIRONMENT_MISMATCH",
      "8b",
    );
    rejects(
      () => validateCsdUpload(upload(official), { ...officialOptions, authorities: [] }),
      "CSD_ENVIRONMENT_MISMATCH",
      "8b",
    );
    rejects(
      () =>
        validateCsdUpload(upload(official), {
          ...officialOptions,
          now: new Date(expected.validTo),
        }),
      "CSD_EXPIRED",
      6,
    );
    rejects(
      () =>
        validateCsdUpload(upload(official), {
          ...officialOptions,
          now: new Date(new Date(expected.validFrom).getTime() - 1000),
        }),
      "CSD_NOT_YET_VALID",
      6,
    );
    rejects(
      () =>
        validateCsdUpload(upload(official), {
          ...officialOptions,
          profileRfc: "SCA010101AB1",
        }),
      "CSD_RFC_MISMATCH",
      7,
    );
  },
);

test("§M.0 expired certificate signed by an allowlisted CA is still rejected", () => {
  const expired = syntheticCsd(authority, {
    validFrom: new Date(Date.now() - 400 * 24 * 3600 * 1000),
    validTo: new Date(Date.now() - 24 * 3600 * 1000),
  });
  rejects(
    () => validateCsdUpload(upload(expired), options),
    "CSD_EXPIRED",
    6,
  );
});

test("private key: encrypted PKCS#8 DER, password, algorithm and pair checks", () => {
  for (const cipher of ["des-ede3-cbc", "aes-256-cbc", "aes-128-cbc"]) {
    const material = syntheticCsd(authority, { cipher });
    const result = validateCsdUpload(upload(material), options);
    const key = createPrivateKey({
      key: result.pkcs8,
      format: "der",
      type: "pkcs8",
    });
    assert(
      new X509Certificate(material.certificate).checkPrivateKey(key),
      cipher,
    );
    result.pkcs8.fill(0);
  }
  const plain = csd.keyObject.export({ type: "pkcs8", format: "der" });
  const key = (bytes: Buffer) => ({ name: "llave.key", bytes });
  rejects(
    () => validateCsdUpload(upload(csd, { privateKey: key(plain) }), options),
    "CSD_KEY_INVALID",
    9,
  );
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, {
          privateKey: key(
            Buffer.from(
              csd.keyObject.export({
                type: "pkcs8",
                format: "pem",
                cipher: "aes-256-cbc",
                passphrase: csd.password,
              }),
            ),
          ),
        }),
        options,
      ),
    "CSD_KEY_INVALID",
    9,
  );
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, { privateKey: key(randomBytes(600)) }),
        options,
      ),
    "CSD_KEY_INVALID",
    9,
  );
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, {
          privateKey: key(Buffer.from(csd.privateKey).subarray(0, 300)),
        }),
        options,
      ),
    "CSD_KEY_INVALID",
    9,
  );
  for (let i = 0; i < 20; i++)
    rejects(
      () =>
        validateCsdUpload(
          upload(csd, { password: syntheticPassword() }),
          options,
        ),
      "CSD_PASSWORD_INVALID",
      10,
    );
  // A damaged first ciphertext block garbles the decrypted PKCS#8 header: for the user
  // this is indistinguishable from a wrong password (§W).
  const corrupted = Buffer.from(csd.privateKey);
  const encrypted = children(corrupted, readDocument(corrupted))[1];
  corrupted[encrypted.contentStart + 2] ^= 0xff;
  rejects(
    () =>
      validateCsdUpload(upload(csd, { privateKey: key(corrupted) }), options),
    "CSD_PASSWORD_INVALID",
    10,
  );
  // PBES1 / unknown scheme (OID of PBES2 rewritten to pbeWithMD5AndDES-CBC).
  const legacy = Buffer.from(csd.privateKey);
  const pbes2 = Buffer.from("2a864886f70d01050d", "hex");
  const at = legacy.indexOf(pbes2);
  legacy[at + pbes2.length - 1] = 0x03;
  rejects(
    () => validateCsdUpload(upload(csd, { privateKey: key(legacy) }), options),
    "CSD_UNSUPPORTED",
    11,
  );
  const other = syntheticCsd(authority);
  rejects(
    () =>
      validateCsdUpload(
        upload(csd, {
          privateKey: key(Buffer.from(other.privateKey)),
          password: other.password,
        }),
        options,
      ),
    "CSD_KEY_MISMATCH",
    12,
  );
  // An EC key inside a valid encrypted container is not an RSA CSD key.
  const ec = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  }).privateKey.export({
    type: "pkcs8",
    format: "der",
    cipher: "aes-256-cbc",
    passphrase: csd.password,
  });
  rejects(
    () => validateCsdUpload(upload(csd, { privateKey: key(ec) }), options),
    "CSD_UNSUPPORTED",
    11,
  );
});

// --- Envelope and KeyProvider (§G–§J) ------------------------------------------------

const context: EnvelopeContext = {
  organizationId: "org-a",
  csdCertificateId: randomUUID(),
  certificateSha256: "a".repeat(64),
  environment: "SANDBOX",
};
const pkcs8 = () => csd.keyObject.export({ type: "pkcs8", format: "der" });
// Compares secret buffers without printing them if an assertion fails.
const same = (a: Uint8Array, b: Uint8Array) =>
  Buffer.from(a).equals(Buffer.from(b));

test("envelope: AES-256-GCM round trip with unique IVs and opaque wrapped DEK", async () => {
  const provider = envKeyProvider(sandboxEnv());
  const first = await sealPrivateKey(provider, context, pkcs8());
  const second = await sealPrivateKey(provider, context, pkcs8());
  assert.equal(first.iv.length, 12);
  assert.equal(first.authTag.length, 16);
  assert.equal(first.wrappedDek.length, 60);
  assert.deepEqual(
    [
      first.envelopeVersion,
      first.aadVersion,
      first.algorithm,
      first.kekProvider,
    ],
    [1, 1, "AES-256-GCM", "env"],
  );
  assert(!same(first.iv, second.iv), "IVs are unique");
  assert(!same(first.ciphertext, second.ciphertext), "ciphertexts differ");
  assert.equal(
    Buffer.from(first.ciphertext).indexOf(pkcs8().subarray(0, 32)),
    -1,
  );
  const opened = await openPrivateKey(provider, context, first);
  assert(same(opened, pkcs8()), "round trip");
});

test("envelope: any AAD, tag, ciphertext or wrapped key change fails closed", async () => {
  const env = sandboxEnv();
  const provider = envKeyProvider(env);
  const sealed = await sealPrivateKey(provider, context, pkcs8());
  const integrity = async (ctx: EnvelopeContext, envelope: SealedPrivateKey) =>
    assert.rejects(openPrivateKey(provider, ctx, envelope), (e: unknown) => {
      assert(e instanceof EnvelopeError);
      assert.equal(e.reason, "INTEGRITY");
      return true;
    });
  await integrity({ ...context, organizationId: "org-b" }, sealed);
  await integrity({ ...context, csdCertificateId: randomUUID() }, sealed);
  await integrity({ ...context, certificateSha256: "b".repeat(64) }, sealed);
  await integrity({ ...context, environment: "PRODUCTION" }, sealed);
  const flip = (bytes: Uint8Array, at = 0) => {
    const copy = Buffer.from(bytes);
    copy[at] ^= 1;
    return copy;
  };
  await integrity(context, { ...sealed, authTag: flip(sealed.authTag) });
  await integrity(context, {
    ...sealed,
    ciphertext: flip(sealed.ciphertext, 10),
  });
  await integrity(context, {
    ...sealed,
    wrappedDek: flip(sealed.wrappedDek, 20),
  });
  await integrity(context, { ...sealed, iv: flip(sealed.iv) });
  await integrity(context, { ...sealed, envelopeVersion: 2 });
  // Same version name, different key material.
  await assert.rejects(
    openPrivateKey(
      envKeyProvider({ ...env, CSD_KEK_V1: kek() }),
      context,
      sealed,
    ),
    (e: unknown) => e instanceof EnvelopeError && e.reason === "INTEGRITY",
  );
  // Missing KEK version: KEY_UNAVAILABLE; never another version "just in case".
  await assert.rejects(
    openPrivateKey(
      envKeyProvider({
        ...env,
        CSD_KEK_V1: "",
        CSD_KEK_V2: kek(),
        CSD_KEK_CURRENT_VERSION: "2",
      }),
      context,
      sealed,
    ),
    (e: unknown) =>
      e instanceof EnvelopeError && e.reason === "KEY_UNAVAILABLE",
  );
  // A row wrapped by another provider is only opened by that provider.
  await assert.rejects(
    openPrivateKey(provider, context, { ...sealed, kekProvider: "kms:aws" }),
    (e: unknown) =>
      e instanceof EnvelopeError && e.reason === "KEY_UNAVAILABLE",
  );
});

test("key provider: no default key, invalid KEK rejected, no fallback between providers", async () => {
  const none = envKeyProvider({});
  assert.deepEqual(none.availability(), {
    available: false,
    reason: "NOT_CONFIGURED",
  });
  await assert.rejects(sealPrivateKey(none, context, pkcs8()), EnvelopeError);
  for (const value of [
    randomBytes(16).toString("base64"),
    randomBytes(33).toString("base64"),
    randomBytes(32).toString("base64url"),
    randomBytes(32).toString("hex"),
    "",
  ])
    assert.deepEqual(
      envKeyProvider(sandboxEnv({ CSD_KEK_V1: value })).availability(),
      {
        available: false,
        reason: "INVALID_CONFIGURATION",
      },
    );
  assert.equal(
    envKeyProvider(sandboxEnv({ CSD_KEK_CURRENT_VERSION: "0" })).availability()
      .available,
    false,
  );
  assert.equal(
    envKeyProvider(sandboxEnv({ CSD_KEK_ID: "" })).availability().available,
    false,
  );
  assert.deepEqual(envKeyProvider(sandboxEnv()).availability(), {
    available: true,
    current: { provider: "env", keyId: "orbit-csd-test", keyVersion: 1 },
  });
  // PRODUCTION never uses "env", even with a complete KEK configuration.
  const production = keyProviderFor(
    "PRODUCTION",
    sandboxEnv({ CSD_KEY_PROVIDER_PRODUCTION: "env" }),
  );
  assert.deepEqual(production.availability(), {
    available: false,
    reason: "INVALID_CONFIGURATION",
  });
  // A configured but unimplemented KMS is unavailable; it does not fall back to "env".
  for (const environment of ["SANDBOX", "PRODUCTION"] as const) {
    const kms = keyProviderFor(
      environment,
      sandboxEnv({
        CSD_KEY_PROVIDER_SANDBOX: "kms:aws",
        CSD_KEY_PROVIDER_PRODUCTION: "kms:aws",
      }),
    );
    assert.equal(kms.provider, "kms:aws");
    assert.equal(kms.availability().available, false);
    await assert.rejects(kms.wrapDataKey(randomBytes(32), Buffer.from("x")));
  }
  assert.equal(
    keyProviderFor(
      "SANDBOX",
      sandboxEnv({ CSD_KEY_PROVIDER_SANDBOX: "" }),
    ).availability().available,
    false,
  );
  assert.equal(
    keyProviderFor(
      "SANDBOX",
      sandboxEnv({ CSD_KEY_PROVIDER_SANDBOX: "plaintext" }),
    ).availability().available,
    false,
  );
});

test("rotation (§J): rewrap keeps the ciphertext and opens with the new version only", async () => {
  const env = sandboxEnv();
  const sealed = await sealPrivateKey(envKeyProvider(env), context, pkcs8());
  const rotated = { ...env, CSD_KEK_V2: kek(), CSD_KEK_CURRENT_VERSION: "2" };
  const rewrapped = await rewrapPrivateKey(
    envKeyProvider(rotated),
    context,
    sealed,
  );
  assert.equal(rewrapped.kekVersion, 2);
  assert(same(rewrapped.ciphertext, sealed.ciphertext), "ciphertext kept");
  assert(same(rewrapped.iv, sealed.iv), "IV kept");
  assert(same(rewrapped.authTag, sealed.authTag), "tag kept");
  assert(!same(rewrapped.wrappedDek, sealed.wrappedDek), "DEK re-wrapped");
  const retired = { ...rotated, CSD_KEK_V1: "" };
  assert(
    same(
      await openPrivateKey(envKeyProvider(retired), context, rewrapped),
      pkcs8(),
    ),
    "opens with the new version",
  );
  await assert.rejects(
    openPrivateKey(envKeyProvider(retired), context, sealed),
    (e: unknown) =>
      e instanceof EnvelopeError && e.reason === "KEY_UNAVAILABLE",
  );
});

// --- Fiscal environment, custody gate and recent sign-in (§D.1, §G.1, §Z) -------------

test("custody is decided by the fiscal environment, never by VERCEL_ENV", () => {
  const authorities = [authorityX509];
  assert.equal(resolveCustody(sandboxEnv(), authorities).available, true);
  assert.equal(
    resolveCustody(
      sandboxEnv({ VERCEL_ENV: "production", VERCEL: "1" }),
      authorities,
    ).available,
    true,
  );
  assert.equal(
    resolveCustody(sandboxEnv({ PAC_ENVIRONMENT: "SANDBOX" }), authorities)
      .environment,
    "SANDBOX",
  );
  const production = resolveCustody(
    sandboxEnv({
      PAC_ENVIRONMENT: "PRODUCTION",
      CSD_KEY_PROVIDER_PRODUCTION: "env",
    }),
    authorities,
  );
  assert.deepEqual(
    [production.environment, production.available],
    ["PRODUCTION", false],
  );
  assert.equal(
    resolveCustody(
      sandboxEnv({
        PAC_ENVIRONMENT: "production",
        CSD_KEY_PROVIDER_PRODUCTION: "kms:aws",
      }),
      authorities,
    ).available,
    false,
  );
  assert.equal(productionLegalGateSatisfied, false);
  // Unknown fiscal environment: configuration error, fail closed.
  assert.equal(fiscalEnvironment({ PAC_ENVIRONMENT: "PROD" }), null);
  assert.equal(
    resolveCustody(sandboxEnv({ PAC_ENVIRONMENT: "PROD" }), authorities)
      .available,
    false,
  );
  // Without a test CA allowlist nothing can be taken into custody.
  assert.equal(resolveCustody(sandboxEnv(), []).available, false);
  assert.equal(resolveCustody({}, authorities).available, false);
});

test("E2E test CA harness: only with ALL local conditions; any real-environment signal disables it", () => {
  const encoded = Buffer.from(authority.certificate).toString("base64");
  const harness: Record<string, string | undefined> = {
    NODE_ENV: "test",
    CSD_E2E_HARNESS: e2eHarnessFlag,
    CSD_E2E_TEST_AUTHORITIES: encoded,
    DATABASE_URL: "postgresql://" + "127.0.0.1:5432/postgres",
  };
  // Without the harness only the official SAT test CA is allowlisted.
  const officialOnly = [acUatSha256];
  assert.deepEqual(testAuthorities({}).map(fingerprint), officialOnly);
  const withSynthetic = [...officialOnly, fingerprint(authorityX509)];
  // Positive control: the local harness of scripts/csd-e2e.mjs adds the synthetic CA.
  assert.equal(e2eHarnessEnabled(harness), true);
  assert.deepEqual(testAuthorities(harness).map(fingerprint), withSynthetic);
  assert.deepEqual(
    testAuthorities({
      ...harness,
      NODE_ENV: "development",
      PAC_ENVIRONMENT: "SANDBOX",
      DATABASE_URL: "postgres://" + "[::1]:5432/postgres",
    }).map(fingerprint),
    withSynthetic,
  );
  assert.equal(resolveCustody({ ...sandboxEnv(), ...harness }).available, true);
  const disabled: [string, Record<string, string | undefined>][] = [
    ["VERCEL=1", { VERCEL: "1" }],
    ["VERCEL_ENV=production", { VERCEL_ENV: "production" }],
    ["VERCEL_ENV=preview", { VERCEL_ENV: "preview" }],
    ["VERCEL_ENV=development", { VERCEL_ENV: "development" }],
    ["VERCEL_URL", { VERCEL_URL: "orbit.example.test" }],
    ["PAC_ENVIRONMENT=PRODUCTION", { PAC_ENVIRONMENT: "PRODUCTION" }],
    ["PAC_ENVIRONMENT=production", { PAC_ENVIRONMENT: "production" }],
    ["PAC_ENVIRONMENT unknown", { PAC_ENVIRONMENT: "PROD" }],
    [
      "remote DATABASE_URL",
      { DATABASE_URL: "postgresql://" + "db.example.test:5432/postgres" },
    ],
    [
      "managed DATABASE_URL",
      {
        DATABASE_URL:
          "postgresql://" + "ep-x.aws.neon.tech/neondb?sslmode=require",
      },
    ],
    [
      "loopback name instead of IP",
      { DATABASE_URL: "postgresql://" + "localhost:5432/postgres" },
    ],
    [
      "host override parameter",
      {
        DATABASE_URL:
          "postgresql://" + "127.0.0.1:5432/postgres?host=db.example.test",
      },
    ],
    ["not PostgreSQL", { DATABASE_URL: "mysql://" + "127.0.0.1:3306/x" }],
    ["no DATABASE_URL", { DATABASE_URL: undefined }],
    ["no explicit flag", { CSD_E2E_HARNESS: undefined }],
    ["flag 1", { CSD_E2E_HARNESS: "1" }],
    ["flag true", { CSD_E2E_HARNESS: "true" }],
    ["NODE_ENV=production", { NODE_ENV: "production" }],
    ["NODE_ENV missing", { NODE_ENV: undefined }],
  ];
  for (const [label, change] of disabled) {
    const env = { ...harness, ...change };
    assert.equal(e2eHarnessEnabled(env), false, label);
    assert.deepEqual(testAuthorities(env).map(fingerprint), officialOnly, label);
    // Without the harness a synthetic certificate is never a demonstrated test CSD.
    rejects(
      () =>
        validateCsdUpload(upload(), {
          ...options,
          authorities: resolveCustody({ ...sandboxEnv(), ...env }).authorities,
        }),
      "CSD_ENVIRONMENT_MISMATCH",
      "8b",
    );
  }
  // A production runtime (process NODE_ENV) disables it whatever the given variables say;
  // `next build` inlines this value, so deployed bundles cannot enable it.
  const processEnv = process.env as Record<string, string | undefined>;
  const previous = processEnv.NODE_ENV;
  try {
    processEnv.NODE_ENV = "production";
    assert.equal(e2eHarnessEnabled(harness), false);
    assert.deepEqual(testAuthorities(harness).map(fingerprint), officialOnly);
  } finally {
    if (previous === undefined) delete processEnv.NODE_ENV;
    else processEnv.NODE_ENV = previous;
  }
  // A non-CA certificate invalidates the whole list, official CA included (fail closed).
  assert.deepEqual(
    testAuthorities({
      ...harness,
      CSD_E2E_TEST_AUTHORITIES:
        encoded + "," + Buffer.from(csd.certificate).toString("base64"),
    }),
    [],
  );
  // A certificate accepted only through that CA is a TEST certificate: SANDBOX only,
  // never PRODUCTION.
  const injected = testAuthorities(harness);
  const accepted = validateCsdUpload(upload(), {
    ...options,
    authorities: injected,
  });
  accepted.pkcs8.fill(0);
  rejects(
    () =>
      validateCsdUpload(upload(), {
        ...options,
        authorities: injected,
        environment: "PRODUCTION",
      }),
    "CSD_ENVIRONMENT_MISMATCH",
    "8b",
  );
});

// Source files of the application (generated Prisma client excluded).
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === "generated"
        ? []
        : sourceFiles(join(dir, entry.name))
      : /\.(ts|tsx)$/.test(entry.name)
        ? [join(dir, entry.name).replace(/\\/g, "/")]
        : [],
  );
const readSources = () =>
  sourceFiles("src").map((file) => ({
    file,
    text: readFileSync(file, "utf8"),
  }));

test("the harness reads only process variables and never request data", () => {
  const sources = readSources();
  assert.deepEqual(
    sources.filter((s) => /CSD_E2E_/.test(s.text)).map((s) => s.file),
    ["src/lib/csd/test-authorities.ts"],
  );
  // Custody is always resolved from the process environment, without arguments.
  const calls = sources
    .filter((s) => /^src\/(services|app)\//.test(s.file))
    .flatMap((s) =>
      [...s.text.matchAll(/resolveCustody\(([^)]*)\)/g)].map((m) => [
        s.file,
        m[1].trim(),
      ]),
    );
  assert(calls.length >= 3);
  for (const [file, args] of calls)
    assert.equal(args, "", `${file} passes arguments to resolveCustody`);
  assert(
    !sources.some(
      (s) =>
        !["src/lib/csd/custody.ts", "src/lib/csd/test-authorities.ts"].includes(
          s.file,
        ) && /\btestAuthorities\(|\be2eHarnessEnabled\(/.test(s.text),
    ),
  );
});

test("fiscal PRODUCTION gate: env provider, missing provider and KMS never enable custody; no VERCEL_ENV value relaxes it", async () => {
  const authorities = [authorityX509];
  for (const vercelEnv of [
    undefined,
    "",
    "development",
    "preview",
    "production",
    "PRODUCTION",
  ])
    for (const [label, provider] of [
      ["env provider", "env"],
      ["provider absent", ""],
      ["KMS without implementation", "kms:aws"],
      ["invalid provider", "plaintext"],
    ]) {
      const custody = resolveCustody(
        sandboxEnv({
          PAC_ENVIRONMENT: "PRODUCTION",
          CSD_KEY_PROVIDER_PRODUCTION: provider,
          ...(vercelEnv === undefined
            ? {}
            : { VERCEL: "1", VERCEL_ENV: vercelEnv }),
        }),
        authorities,
      );
      const name = `${label} / VERCEL_ENV=${vercelEnv}`;
      assert.equal(custody.environment, "PRODUCTION", name);
      assert.equal(custody.available, false, name);
      assert.equal(custody.provider?.availability().available, false, name);
      await assert.rejects(
        custody.provider!.wrapDataKey(randomBytes(32), Buffer.from("aad")),
        name,
      );
      // Hosting never changes SANDBOX either.
      assert.equal(
        resolveCustody(
          sandboxEnv(
            vercelEnv === undefined
              ? {}
              : { VERCEL: "1", VERCEL_ENV: vercelEnv },
          ),
          authorities,
        ).available,
        true,
        name,
      );
    }
  // No KMS → env fallback: an envelope made by "env" is never opened by the PRODUCTION
  // provider, even with a complete env KEK configuration in the same process.
  const env = sandboxEnv({ CSD_KEY_PROVIDER_PRODUCTION: "kms:aws" });
  const sealed = await sealPrivateKey(envKeyProvider(env), context, pkcs8());
  for (const provider of [
    keyProviderFor("PRODUCTION", env),
    keyProviderFor("PRODUCTION", {
      ...env,
      CSD_KEY_PROVIDER_PRODUCTION: "env",
    }),
    keyProviderFor("PRODUCTION", { ...env, CSD_KEY_PROVIDER_PRODUCTION: "" }),
  ])
    await assert.rejects(
      openPrivateKey(provider, context, sealed),
      (e: unknown) =>
        e instanceof EnvelopeError && e.reason === "KEY_UNAVAILABLE",
    );
});

test("recent sign-in window (§D.1): 900 s by default, 60–3600 s, invalid values use the default", () => {
  assert.equal(reauthWindowSeconds({}), 900);
  for (const value of ["30", "4000", "abc", "-5", "1e3", " "])
    assert.equal(
      reauthWindowSeconds({ CSD_REAUTH_WINDOW_SECONDS: value }),
      900,
      value,
    );
  assert.equal(reauthWindowSeconds({ CSD_REAUTH_WINDOW_SECONDS: "120" }), 120);
  const at = new Date("2026-10-11T12:00:00Z");
  const ago = (s: number) => new Date(at.getTime() - s * 1000);
  assert.equal(isRecentSignIn(ago(899), at, {}), true);
  assert.equal(isRecentSignIn(ago(900), at, {}), false);
  assert.equal(
    isRecentSignIn(ago(119), at, { CSD_REAUTH_WINDOW_SECONDS: "120" }),
    true,
  );
  assert.equal(
    isRecentSignIn(ago(121), at, { CSD_REAUTH_WINDOW_SECONDS: "120" }),
    false,
  );
  assert.equal(isRecentSignIn(new Date(Number.NaN), at, {}), false);
});

// --- Errors, redaction and audit (§N, §Q, §R) -----------------------------------------

test("error codes keep the contract statuses and never expose internals", async () => {
  const expected: Record<string, number> = {
    CSD_CERTIFICATE_INVALID: 400,
    CSD_KEY_INVALID: 400,
    CSD_PASSWORD_INVALID: 400,
    CSD_KEY_MISMATCH: 422,
    CSD_EXPIRED: 422,
    CSD_NOT_YET_VALID: 422,
    CSD_RFC_MISMATCH: 422,
    CSD_ISSUER_PROFILE_REQUIRED: 409,
    CSD_FILE_TOO_LARGE: 413,
    CSD_UNSUPPORTED: 422,
    CSD_FILES_REQUIRED: 400,
    CSD_CUSTODY_TERMS_REQUIRED: 400,
    CSD_RFC_UNVERIFIABLE: 422,
    CSD_ALREADY_ACTIVE: 409,
    CSD_CONFLICT: 409,
    CSD_IN_USE: 409,
    CSD_FORBIDDEN: 403,
    CSD_REAUTH_REQUIRED: 401,
    CSD_ENVIRONMENT_MISMATCH: 422,
    CSD_RATE_LIMITED: 429,
    CSD_SERVICE_UNAVAILABLE: 503,
    CSD_ENCRYPTION_FAILED: 503,
    CSD_NOT_FOUND: 404,
  };
  assert.deepEqual([...csdErrorCodes].sort(), Object.keys(expected).sort());
  for (const code of csdErrorCodes) {
    assert.equal(csdErrorStatus(code), expected[code], code);
    const response = csdApiError(new CsdError(code));
    assert.equal(response.status, expected[code]);
    const body = await response.json();
    assert.equal(body.code, code);
    assert(!openSslText.test(body.error));
  }
  const original = console.error;
  const logged: string[] = [];
  console.error = (line: string) => logged.push(line);
  try {
    const leak = new Error(
      "error:1C800064:Provider routines::bad decrypt " + csd.password,
    );
    const response = csdApiError(leak);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "La custodia del CSD no está disponible en este momento.",
      code: "CSD_SERVICE_UNAVAILABLE",
    });
  } finally {
    console.error = original;
  }
  assert(!logged.join("\n").includes(csd.password));
  assert(
    !openSslText.test(logged.join("\n").replace(/"scope":"api\/csd"/, "")),
  );
});

test("redaction removes PEM blocks and CSD envelope fields", () => {
  const certificatePem = new X509Certificate(csd.certificate).toString();
  const encryptedPem = csd.keyObject
    .export({
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: csd.password,
    })
    .toString();
  const text = redactText(`a ${certificatePem} b ${encryptedPem} c`, 10_000);
  assert.equal(text.replace(/\s+/g, " "), "a [pem] b [private-key] c");
  const cut = certificatePem.slice(0, 120);
  assert.equal(redactText("x " + cut, 10_000), "x [pem]");
  const fields = [
    "password",
    "privateKey",
    "certificate",
    "wrappedDek",
    "ciphertext",
    "authTag",
    "iv",
    "kekVersion",
    "kekId",
    "dek",
  ];
  const redacted = redact(
    Object.fromEntries(fields.map((f) => [f, "value-" + f])),
  ) as Record<string, unknown>;
  for (const field of fields)
    assert.equal(redacted[field], "[redacted]", field);
});

test("CSD audit metadata keeps only the catalog keys", () => {
  const previous = randomUUID();
  assert.deepEqual(
    sanitizeAuditMetadata("csd.replaced", {
      previousCertificateId: previous,
      certificateNumber: "30001000000500003416",
      rfc: "SCA010101AB1",
      password: csd.password,
    }),
    {
      previousCertificateId: previous,
      certificateNumber: "30001000000500003416",
    },
  );
  assert.deepEqual(
    sanitizeAuditMetadata("csd.replaced", {
      previousCertificateId: "not-a-uuid",
    }),
    undefined,
  );
  assert.deepEqual(
    sanitizeAuditMetadata("csd.configuration.failed", {
      errorCode: "CSD_PASSWORD_INVALID",
      stage: 10,
      message: "bad decrypt",
      ciphertext: "x",
    }),
    { errorCode: "CSD_PASSWORD_INVALID", stage: 10 },
  );
  assert.deepEqual(
    sanitizeAuditMetadata("csd.configured", {
      certificateNumber: "30001000000500003416",
      environment: "SANDBOX",
      validTo: "2027-10-11T00:00:00.000Z",
      created: true,
      certificateDer: "MIIB",
    }),
    {
      certificateNumber: "30001000000500003416",
      environment: "SANDBOX",
      validTo: "2027-10-11T00:00:00.000Z",
      created: true,
    },
  );
});

test("leak review: CSD code never logs, decrypts only in the vault, signs only to validate and stays out of analytics", () => {
  const sources = readSources();
  const csdFiles = sources.filter((s) =>
    /^src\/(lib\/csd\/|services\/csd|app\/api\/csd\/)/.test(s.file),
  );
  assert(csdFiles.length >= 15);
  for (const { file, text } of csdFiles)
    assert(!/\bconsole\./.test(text), `${file} uses console`);
  const users = (pattern: RegExp) =>
    sources.filter((s) => pattern.test(s.text)).map((s) => s.file);
  // Decryption: the envelope module, plus the store's integrity check, which no route,
  // session service or page calls.
  assert.deepEqual(users(/\bopenPrivateKey\(/), [
    "src/lib/csd/envelope.ts",
    "src/services/csd-store.ts",
  ]);
  assert.deepEqual(users(/\bunwrapDataKey\(/), [
    "src/lib/csd/envelope.ts",
    "src/lib/csd/key-provider.ts",
  ]);
  assert.deepEqual(users(/\bverifyActiveCsdEnvelope\b/), [
    "src/services/csd-store.ts",
  ]);
  // Signatures: the step 12 challenge with the uploaded key, before storage, and (Fase 5C.6)
  // the CFDI seal, only in lib/csd/signing.ts with the padding set explicitly, reached only
  // through the signing service.
  assert.deepEqual(
    users(/\b(createSign|sign)\(/).filter((f) => f.includes("csd")),
    ["src/lib/csd/private-key.ts", "src/lib/csd/signing.ts"],
  );
  const signing = sources.find((s) => s.file === "src/lib/csd/signing.ts")!;
  assert.match(signing.text, /padding: cfdiSealAlgorithm\.padding/);
  assert.match(signing.text, /padding: constants\.RSA_PKCS1_PADDING/);
  assert.doesNotMatch(signing.text, /RSA_PKCS1_PSS_PADDING|saltLength/);
  assert.deepEqual(users(/\bsignWithCustodiedKey\(/), [
    "src/lib/csd/signing.ts",
    "src/services/csd-signing.ts",
  ]);
  for (const path of [
    "/dashboard/stamping",
    "/api/csd",
    "/api/csd/history",
    "/api/csd/custody-terms",
    "/api/csd/disable",
  ])
    assert.equal(analyticsPath(path), null, path);
  // Errors serialize without secrets: only status, code and stage.
  const error = new CsdError("CSD_PASSWORD_INVALID", 10);
  assert.deepEqual(JSON.parse(JSON.stringify(error)), {
    status: 400,
    code: "CSD_PASSWORD_INVALID",
    csdCode: "CSD_PASSWORD_INVALID",
    stage: 10,
    name: "CsdError",
  });
});

test("custody terms are versioned and marked provisional", () => {
  assert.match(csdCustodyTerms.version, /borrador/);
  assert.match(csdCustodyTerms.text, /sujeta a revisión jurídica/);
  assert.match(csdCustodyTerms.text, /no se guarda/);
  assert.match(csdCustodyTerms.text, /nunca solicita la e\.firma/);
});

test("synthetic fixtures are DER built in memory (no files, no PEM private keys)", () => {
  assert.equal(der(0x05)[0], 0x05);
  assert.equal(csd.certificate[0], 0x30);
  assert.equal(Buffer.from(csd.privateKey).includes("PRIVATE KEY"), false);
});
