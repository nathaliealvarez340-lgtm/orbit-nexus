// Fase 5C.3 §M.7/§M.9: minimal, read-only DER reader for the structures node:crypto does
// not expose: the subject attributes of an X.509 certificate and the outer structure of a
// PKCS#8 EncryptedPrivateKeyInfo. It never decrypts, signs or verifies; all cryptography
// stays in node:crypto (OpenSSL). Strict DER only: definite, minimal lengths and no
// trailing bytes.

export class DerError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DerError";
  }
}

export type Tlv = {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
};

export const tag = {
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  null: 0x05,
  oid: 0x06,
  utf8String: 0x0c,
  printableString: 0x13,
  teletexString: 0x14,
  ia5String: 0x16,
  universalString: 0x1c,
  bmpString: 0x1e,
  sequence: 0x30,
  set: 0x31,
  explicit0: 0xa0,
} as const;

const maxChildren = 256;

export function readTlv(
  buffer: Uint8Array,
  offset: number,
  limit = buffer.length,
): Tlv {
  if (offset + 2 > limit) throw new DerError("TRUNCATED");
  const identifier = buffer[offset];
  // Multi-byte tags never appear in the structures read here.
  if ((identifier & 0x1f) === 0x1f) throw new DerError("UNSUPPORTED_TAG");
  let length = buffer[offset + 1];
  let contentStart = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    // 0 = indefinite length (BER, not DER); more than 3 bytes is far above any limit here.
    if (count === 0 || count > 3) throw new DerError("LENGTH");
    if (contentStart + count > limit) throw new DerError("TRUNCATED");
    if (buffer[contentStart] === 0) throw new DerError("NON_MINIMAL_LENGTH");
    length = 0;
    for (let i = 0; i < count; i++)
      length = length * 256 + buffer[contentStart + i];
    if (length < 0x80) throw new DerError("NON_MINIMAL_LENGTH");
    contentStart += count;
  }
  const end = contentStart + length;
  if (end > limit) throw new DerError("TRUNCATED");
  return { tag: identifier, start: offset, contentStart, end };
}

/** The single top-level element; it must span the whole buffer. */
export function readDocument(buffer: Uint8Array) {
  const root = readTlv(buffer, 0);
  if (root.end !== buffer.length) throw new DerError("TRAILING_DATA");
  return root;
}

export function children(buffer: Uint8Array, parent: Tlv) {
  if (!(parent.tag & 0x20)) throw new DerError("NOT_CONSTRUCTED");
  const items: Tlv[] = [];
  let offset = parent.contentStart;
  while (offset < parent.end) {
    const item = readTlv(buffer, offset, parent.end);
    items.push(item);
    if (items.length > maxChildren) throw new DerError("TOO_MANY_ELEMENTS");
    offset = item.end;
  }
  return items;
}

export function expectTag(item: Tlv | undefined, expected: number): Tlv {
  if (!item || item.tag !== expected) throw new DerError("UNEXPECTED_TAG");
  return item;
}

export const content = (buffer: Uint8Array, item: Tlv) =>
  buffer.subarray(item.contentStart, item.end);

export function decodeOid(buffer: Uint8Array, item: Tlv) {
  const bytes = content(buffer, expectTag(item, tag.oid));
  if (!bytes.length || bytes.length > 64) throw new DerError("OID");
  const arcs: number[] = [];
  let value = 0;
  let started = false;
  for (const byte of bytes) {
    // A leading 0x80 would be a non-minimal encoding of the arc.
    if (!started && byte === 0x80) throw new DerError("OID");
    started = true;
    value = value * 128 + (byte & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER / 128) throw new DerError("OID");
    if (!(byte & 0x80)) {
      arcs.push(value);
      value = 0;
      started = false;
    }
  }
  if (started) throw new DerError("OID");
  const first = arcs.shift()!;
  const head =
    first < 40 ? [0, first] : first < 80 ? [1, first - 40] : [2, first - 80];
  return [...head, ...arcs].join(".");
}

/** Text of an X.520 DirectoryString-like value; null for any other type. */
export function decodeString(buffer: Uint8Array, item: Tlv): string | null {
  const bytes = content(buffer, item);
  try {
    switch (item.tag) {
      case tag.utf8String:
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      case tag.printableString:
      case tag.ia5String:
        if (bytes.some((byte) => byte > 0x7f)) return null;
        return Buffer.from(bytes).toString("latin1");
      case tag.teletexString:
        return Buffer.from(bytes).toString("latin1");
      case tag.bmpString: {
        if (bytes.length % 2) return null;
        const swapped = Buffer.from(bytes);
        swapped.swap16();
        return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export type NameAttribute = { oid: string; value: string | null };

/** Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue } */
function certificateParts(der: Uint8Array) {
  const root = expectTag(readDocument(der), tag.sequence);
  const [tbs, signatureAlgorithm, signatureValue, ...rest] = children(
    der,
    root,
  );
  expectTag(tbs, tag.sequence);
  expectTag(signatureAlgorithm, tag.sequence);
  expectTag(signatureValue, tag.bitString);
  if (rest.length) throw new DerError("UNEXPECTED_ELEMENT");
  return { tbs, signatureAlgorithm };
}

/** Attributes of the certificate subject, in order (RDN by RDN). */
export function certificateSubject(der: Uint8Array): NameAttribute[] {
  const { tbs } = certificateParts(der);
  const fields = children(der, tbs);
  // [0] version is optional; then serialNumber, signature, issuer, validity, subject.
  const first = fields[0]?.tag === tag.explicit0 ? 1 : 0;
  const subject = expectTag(fields[first + 4], tag.sequence);
  const attributes: NameAttribute[] = [];
  for (const rdn of children(der, subject)) {
    for (const pair of children(der, expectTag(rdn, tag.set))) {
      const [type, value, ...extra] = children(
        der,
        expectTag(pair, tag.sequence),
      );
      if (!value || extra.length) throw new DerError("NAME");
      attributes.push({
        oid: decodeOid(der, type),
        value: decodeString(der, value),
      });
    }
  }
  return attributes;
}

// RFC 5280 §4.1.2.5: UTCTime YYMMDDHHMMSSZ (YY ≥ 50 ⇒ 19YY) or GeneralizedTime
// YYYYMMDDHHMMSSZ, always in UTC and without fractions.
function decodeTime(buffer: Uint8Array, item: Tlv) {
  const text = Buffer.from(content(buffer, item)).toString("latin1");
  const match =
    item.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
      : item.tag === 0x18
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
        : null;
  if (!match) throw new DerError("TIME");
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const year = item.tag === 0x17 ? (y >= 50 ? 1900 + y : 2000 + y) : y;
  const date = new Date(Date.UTC(year, mo - 1, d, h, mi, s));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    h > 23 ||
    mi > 59 ||
    s > 59
  )
    throw new DerError("TIME");
  return date;
}

/** Validity { notBefore, notAfter } of the certificate. */
export function certificateValidity(der: Uint8Array) {
  const { tbs } = certificateParts(der);
  const fields = children(der, tbs);
  const first = fields[0]?.tag === tag.explicit0 ? 1 : 0;
  const [notBefore, notAfter, ...rest] = children(
    der,
    expectTag(fields[first + 3], tag.sequence),
  );
  if (!notBefore || !notAfter || rest.length) throw new DerError("VALIDITY");
  return {
    validFrom: decodeTime(der, notBefore),
    validTo: decodeTime(der, notAfter),
  };
}

/** OID of the certificate's outer signature algorithm. */
export function certificateSignatureAlgorithm(der: Uint8Array) {
  const { signatureAlgorithm } = certificateParts(der);
  return decodeOid(der, children(der, signatureAlgorithm)[0]);
}

export type EncryptedKeyStructure = {
  /** Encryption scheme OID (PBES2 = 1.2.840.113549.1.5.13). */
  scheme: string;
  /** PBES2 only: key derivation function and cipher OIDs. */
  kdf: string | null;
  cipher: string | null;
};

/**
 * EncryptedPrivateKeyInfo ::= SEQUENCE { encryptionAlgorithm AlgorithmIdentifier,
 * encryptedData OCTET STRING }. An unencrypted PrivateKeyInfo starts with an INTEGER
 * version instead, so it is rejected here.
 */
export function encryptedPrivateKeyInfo(
  der: Uint8Array,
): EncryptedKeyStructure {
  const root = expectTag(readDocument(der), tag.sequence);
  const [algorithm, data, ...rest] = children(der, root);
  expectTag(algorithm, tag.sequence);
  if (expectTag(data, tag.octetString).end === data.contentStart || rest.length)
    throw new DerError("ENCRYPTED_KEY");
  const [schemeOid, parameters] = children(der, algorithm);
  const scheme = decodeOid(der, schemeOid);
  if (scheme !== "1.2.840.113549.1.5.13")
    return { scheme, kdf: null, cipher: null };
  // PBES2-params ::= SEQUENCE { keyDerivationFunc AlgorithmIdentifier, encryptionScheme AlgorithmIdentifier }
  const [kdf, cipher, ...more] = children(
    der,
    expectTag(parameters, tag.sequence),
  );
  if (more.length) throw new DerError("PBES2");
  return {
    scheme,
    kdf: decodeOid(der, children(der, expectTag(kdf, tag.sequence))[0]),
    cipher: decodeOid(der, children(der, expectTag(cipher, tag.sequence))[0]),
  };
}
