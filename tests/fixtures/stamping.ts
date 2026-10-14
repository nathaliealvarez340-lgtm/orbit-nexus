// Fase 5C.8 test helpers. SYNTHETIC only: CSD and "SAT" keys are generated at runtime, and
// every PAC response here is a SIMULATION of the shapes documented by SW (developers.sw.com.mx
// "Timbrado V4 – CustomID" and "Stamp"), built to exercise ORBIT's verification. Nothing here
// was returned by a real PAC; a simulated stamp proves nothing about SAT validity.
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { buildPreSealCfdi40 } from "../../src/lib/cfdi40/build";
import {
  loadCfdi40Catalogs,
  type Cfdi40Catalogs,
} from "../../src/lib/cfdi40/catalogs";
import {
  compileCfdi40Xslt,
  generateCfdi40OriginalString,
} from "../../src/lib/cfdi40/original-string";
import { validateSealedCfdi40Xsd } from "../../src/lib/cfdi40/schema";
import { createSealedCfdi40 } from "../../src/lib/cfdi40/sealed";
import { stampedCfdi40XsdSet } from "../../src/lib/cfdi40/stamped-schema";
import type { StampedVerificationDeps } from "../../src/lib/cfdi40/stamped";
import {
  loadTfd11Bundle,
  tfd11SchemaLocation,
  tfdNamespace,
} from "../../src/lib/cfdi40/tfd-resources";
import { loadCfdi40XsdEngine } from "../../src/lib/cfdi40/xsd-engine";
import { loadCfdi40XsdBundle } from "../../src/lib/cfdi40/xsd-resources";
import { cfdi40XsltEngine } from "../../src/lib/cfdi40/xslt-engine";
import { loadCfdi40XsltBundle } from "../../src/lib/cfdi40/xslt-resources";
import type {
  Cfdi40CertificateBinding,
  SealedCfdi40Xml,
  XsdValidatedCfdi40,
} from "../../src/lib/cfdi40/types";
import { signCfdiSeal } from "../../src/lib/csd/signing";
import { issuedAt, validFixtures } from "./cfdi40";
import { syntheticAuthority, syntheticCsd } from "./synthetic-csd.mjs";

export const fixtureNames = Object.keys(
  validFixtures,
) as (keyof typeof validFixtures)[];
export const authority = syntheticAuthority();
export const csd = syntheticCsd(authority, {
  certificateNumber: "30001000000000000001",
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2036-01-01T00:00:00Z"),
});
export const binding: Cfdi40CertificateBinding = {
  noCertificado: "30001000000000000001",
  certificadoBase64: Buffer.from(csd.certificate).toString("base64"),
};
/** Synthetic stand-in for the SAT stamping key (the real SelloSAT is never verified here). */
export const satKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey;
export const satCertificateNumber = "30001000000400002495";
export const pacRfc = "SPR190613I52";

export type StampingKit = {
  catalogs: Cfdi40Catalogs;
  verification: StampedVerificationDeps;
  /** The real pipeline: pre-seal → official cadena → synthetic CSD signature → sealed. */
  seal(name: keyof typeof validFixtures): SealedCfdi40Xml;
  validate(sealed: SealedCfdi40Xml): XsdValidatedCfdi40;
  tfdCadena(attributes: TfdAttributes): string;
};
export type TfdAttributes = {
  Version: string;
  UUID: string;
  FechaTimbrado: string;
  RfcProvCertif: string;
  Leyenda?: string;
  SelloCFD: string;
  NoCertificadoSAT: string;
  SelloSAT?: string;
};

export async function stampingKit(): Promise<StampingKit> {
  const catalogs = await loadCfdi40Catalogs();
  const xslt = await loadCfdi40XsltBundle();
  const stylesheet = compileCfdi40Xslt(cfdi40XsltEngine, xslt);
  const engine = await loadCfdi40XsdEngine();
  const bundle = await loadCfdi40XsdBundle();
  const tfd = await loadTfd11Bundle();
  const verification: StampedVerificationDeps = {
    engine,
    set: stampedCfdi40XsdSet(bundle, tfd),
    xslt: { engine: cfdi40XsltEngine, tfd },
  };
  const tfdStylesheet = cfdi40XsltEngine.compile(
    { url: tfd.xslt.url, text: tfd.xslt.text },
    () => {
      throw new Error("no includes");
    },
  );
  return {
    catalogs,
    verification,
    seal(name) {
      const preSeal = buildPreSealCfdi40(validFixtures[name].invoice(), {
        issuedAt,
        catalogs,
        certificate: binding,
      }).xml;
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
    },
    validate: (sealed) => validateSealedCfdi40Xsd(sealed, { engine, bundle }),
    tfdCadena(attributes) {
      const attrs = Object.entries({
        "xmlns:tfd": tfdNamespace,
        ...attributes,
      })
        .filter(([, value]) => value !== undefined)
        .map(
          ([key, value]) =>
            `${key}="${String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`,
        )
        .join(" ");
      return tfdStylesheet.transformToText(
        `<?xml version="1.0" encoding="UTF-8"?><tfd:TimbreFiscalDigital ${attrs}/>`,
      );
    },
  };
}

const attributeOf = (xml: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(xml)?.[1] ?? "";

export type SimulatedStamp = {
  uuid: string;
  tfd: TfdAttributes & { SelloSAT: string };
  tfdXml: string;
  cfdi: string;
  cadena: string;
  /** A v4 "data" object as SW documents it. */
  data: Record<string, string>;
};

/**
 * What a PAC would return for `sent`: the same XML with one cfdi:Complemento holding a TFD
 * 1.1 whose SelloCFD is the Sello sent and whose SelloSAT is a synthetic signature over the
 * official TFD cadena. Test-only text assembly (simulating the PAC side).
 */
export function simulateStamp(
  kit: StampingKit,
  sent: { xml: string },
  options: {
    uuid?: string;
    fecha?: string;
    tfdOverrides?: Partial<TfdAttributes>;
  } = {},
): SimulatedStamp {
  const uuid = options.uuid ?? randomUUID().toUpperCase();
  const base: TfdAttributes = {
    Version: "1.1",
    UUID: uuid,
    FechaTimbrado: options.fecha ?? "2026-10-12T12:31:00",
    RfcProvCertif: pacRfc,
    SelloCFD: attributeOf(sent.xml, "Sello"),
    NoCertificadoSAT: satCertificateNumber,
    ...options.tfdOverrides,
  };
  const cadena = kit.tfdCadena(base);
  const SelloSAT =
    options.tfdOverrides?.SelloSAT ??
    sign("sha256", Buffer.from(cadena, "utf8"), satKey).toString("base64");
  const tfd = { ...base, SelloSAT };
  const attrs = Object.entries(tfd)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  const tfdNode = `<tfd:TimbreFiscalDigital xmlns:tfd="${tfdNamespace}" xsi:schemaLocation="${tfd11SchemaLocation}" ${attrs}/>`;
  const cfdi = sent.xml.replace(
    "</cfdi:Comprobante>",
    `<cfdi:Complemento>${tfdNode}</cfdi:Complemento></cfdi:Comprobante>`,
  );
  const tfdXml = `<?xml version="1.0" encoding="utf-8"?><tfd:TimbreFiscalDigital xmlns:tfd="${tfdNamespace}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${tfd11SchemaLocation}" ${attrs} />`;
  return {
    uuid,
    tfd,
    tfdXml,
    cfdi,
    cadena,
    data: {
      cadenaOriginalSAT: cadena,
      noCertificadoSAT: tfd.NoCertificadoSAT,
      noCertificadoCFDI: attributeOf(sent.xml, "NoCertificado"),
      uuid: uuid.toLowerCase(),
      selloSAT: SelloSAT,
      selloCFDI: tfd.SelloCFD,
      fechaTimbrado: tfd.FechaTimbrado,
      qrCode:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      cfdi,
    },
  };
}

/** A JSON Response as SW would send it. */
export const swJson = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

/** The parts of a multipart request built by the SW adapter. */
export function readMultipart(init: RequestInit) {
  const headers = new Headers(init.headers);
  const type = headers.get("content-type") ?? "";
  const boundary = /boundary=([^;]+)/.exec(type)?.[1] ?? "";
  const body = Buffer.from(init.body as Uint8Array);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="xml"; filename="cfdi.xml"\r\nContent-Type: text/xml\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const wellFormed =
    !!boundary &&
    body.subarray(0, head.length).equals(head) &&
    body.subarray(body.length - tail.length).equals(tail);
  return {
    wellFormed,
    xml: new Uint8Array(body.subarray(head.length, body.length - tail.length)),
    authorization: headers.get("authorization"),
    customId: headers.get("customid"),
  };
}
