// SYNTHETIC CSD-like material for automated tests only. Everything is generated at runtime
// with node:crypto and signed by a SYNTHETIC test CA. These certificates DO NOT PROVE SAT
// VALIDITY: they only imitate the layout that Fase 5C.3 §M.7/§M.8 still has to confirm with
// official SAT test CSD (RFC in x500UniqueIdentifier, serial number made of ASCII digits).
// Nothing here is a real certificate, key, RFC or password; nothing is written to disk.
import { generateKeyPairSync, randomBytes, randomInt, sign } from "node:crypto";

const lengthBytes = (n) =>
  n < 0x80
    ? Buffer.from([n])
    : n < 0x100
      ? Buffer.from([0x81, n])
      : n < 0x10000
        ? Buffer.from([0x82, n >> 8, n & 0xff])
        : Buffer.from([0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);

/** DER TLV with a definite, minimal length. */
export const der = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), lengthBytes(body.length), body]);
};
export const sequence = (...parts) => der(0x30, ...parts);
const set = (...parts) => der(0x31, ...parts);
const integer = (bytes) =>
  der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
export const oid = (dotted) => {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (const arc of rest) {
    const stack = [arc & 0x7f];
    for (let v = Math.floor(arc / 128); v > 0; v = Math.floor(v / 128))
      stack.unshift((v & 0x7f) | 0x80);
    out.push(...stack);
  }
  return der(0x06, Buffer.from(out));
};
const utf8 = (text) => der(0x0c, Buffer.from(text, "utf8"));
const time = (date) => {
  const digits = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return date.getUTCFullYear() < 2050
    ? der(0x17, Buffer.from(digits.slice(2) + "Z"))
    : der(0x18, Buffer.from(digits + "Z"));
};
const sha256WithRsa = sequence(oid("1.2.840.113549.1.1.11"), der(0x05));
// A Buffer is an already encoded DER Name, copied byte for byte (impostor CA tests).
const name = (attributes) =>
  Buffer.isBuffer(attributes)
    ? attributes
    : sequence(
        ...attributes.map(([type, value]) =>
          set(sequence(oid(type), utf8(value))),
        ),
      );

/** X.509 v3 DER signed with RSA-SHA256 by `signingKey`. */
export function syntheticCertificate({
  subject,
  issuer,
  publicKey,
  signingKey,
  serial,
  notBefore,
  notAfter,
  ca = false,
}) {
  const basicConstraints = sequence(
    oid("2.5.29.19"),
    der(0x01, Buffer.from([0xff])),
    der(0x04, sequence(...(ca ? [der(0x01, Buffer.from([0xff]))] : []))),
  );
  const tbs = sequence(
    der(0xa0, integer(Buffer.from([2]))),
    integer(serial),
    sha256WithRsa,
    name(issuer),
    sequence(time(notBefore), time(notAfter)),
    name(subject),
    publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, sequence(basicConstraints)),
  );
  return sequence(
    tbs,
    sha256WithRsa,
    der(0x03, Buffer.from([0]), sign("sha256", tbs, signingKey)),
  );
}

const day = 24 * 3600 * 1000;

/**
 * Synthetic CA. Never an official SAT or PAC authority. `rawSubject` (DER Name) makes an
 * impostor with exactly the subject of a real CA but its own key.
 * @param {string} [label]
 * @param {{ rawSubject?: Buffer }} [options]
 */
export function syntheticAuthority(
  label = "AC SINTETICA DE PRUEBAS",
  { rawSubject } = {},
) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const subject = rawSubject ?? [
    ["2.5.4.3", label + " NO SAT"],
    ["2.5.4.10", "ORBIT NEXUS PRUEBAS SINTETICAS"],
  ];
  const serial = randomBytes(8);
  serial[0] &= 0x7f;
  const certificate = syntheticCertificate({
    subject,
    issuer: subject,
    publicKey,
    signingKey: privateKey,
    serial,
    notBefore: new Date(Date.now() - 365 * day),
    notAfter: new Date(Date.now() + 3650 * day),
    ca: true,
  });
  return { certificate, privateKey, subject };
}

/** Synthetic password, marked so leak checks can search for it. Never a real one. */
export const syntheticPassword = () =>
  "Synthetic-CSD-PASSWORD-MARK-" + randomBytes(9).toString("hex");

/** 20 ASCII digits, the NoCertificado hypothesis of §M.8. */
export const syntheticCertificateNumber = () =>
  "30001" + Array.from({ length: 15 }, () => randomInt(10)).join("");

/**
 * CSD-like certificate and encrypted PKCS#8 key issued by `authority`.
 * `subjectRfc` overrides the whole x500UniqueIdentifier value; null omits it.
 * @param {ReturnType<typeof syntheticAuthority>} authority
 * @param {{
 *   rfc?: string, representativeRfc?: string, subjectRfc?: string | null,
 *   certificateNumber?: string, serial?: Buffer, validFrom?: Date, validTo?: Date,
 *   keyType?: "rsa" | "ec", modulusLength?: number, password?: string,
 *   cipher?: string, ca?: boolean
 * }} [options]
 */
export function syntheticCsd(
  authority,
  {
    rfc = "SCA010101AB1",
    representativeRfc = "XAXX010101000",
    subjectRfc,
    certificateNumber = syntheticCertificateNumber(),
    serial,
    validFrom = new Date(Date.now() - day),
    validTo = new Date(Date.now() + 365 * day),
    keyType = "rsa",
    modulusLength = 2048,
    password = syntheticPassword(),
    cipher = "des-ede3-cbc",
    ca = false,
  } = {},
) {
  const keys =
    keyType === "rsa"
      ? generateKeyPairSync("rsa", { modulusLength })
      : generateKeyPairSync("ec", { namedCurve: "P-256" });
  const x500 =
    subjectRfc === undefined ? `${rfc} / ${representativeRfc}` : subjectRfc;
  const subject = [
    ["2.5.4.3", "EMPRESA SINTETICA DE PRUEBA"],
    ["2.5.4.41", "EMPRESA SINTETICA DE PRUEBA"],
    ["2.5.4.10", "EMPRESA SINTETICA DE PRUEBA"],
    ...(x500 === null ? [] : [["2.5.4.45", x500]]),
    ["2.5.4.5", " / SINTETICO"],
    ["2.5.4.11", "PRUEBAS SINTETICAS"],
  ];
  const certificate = syntheticCertificate({
    subject,
    issuer: authority.subject,
    publicKey: keys.publicKey,
    signingKey: authority.privateKey,
    serial: serial ?? Buffer.from(certificateNumber, "latin1"),
    notBefore: validFrom,
    notAfter: validTo,
    ca,
  });
  const privateKey = keys.privateKey.export({
    type: "pkcs8",
    format: "der",
    cipher,
    passphrase: password,
  });
  return {
    certificate,
    privateKey,
    password,
    keyObject: keys.privateKey,
    certificateNumber,
    rfc,
  };
}
