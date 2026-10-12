import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { Cfdi40Error, cfdi40Issue } from "./errors";
import type {
  Cfdi40Concept,
  Cfdi40Document,
  Cfdi40Taxes,
  Cfdi40Transfer,
  UnsignedCfdi40Xml,
} from "./types";
import {
  XmlSerializationError,
  serializeXml,
  type XmlAttribute,
  type XmlElement,
} from "./xml";

// Fase 5C.4: Cfdi40Document → unsigned CFDI 4.0 XML.
// - Element order follows the xs:sequence of cfdv40.xsd (Comprobante: Emisor, Receptor,
//   Conceptos, Impuestos; Concepto/Impuestos: Traslados, Retenciones; Comprobante/
//   Impuestos: Retenciones, Traslados).
// - Attributes are written in their cfdv40.xsd declaration order; absent optional ones are
//   omitted (never empty, never invented). Sello, NoCertificado and Certificado keep their
//   positions in that order for the sealing block but are never written here.
// - After serializing, the XML is parsed back and must reproduce the tree exactly.

export const cfdi40Namespace = "http://www.sat.gob.mx/cfd/4";
export const cfdi40SchemaLocation =
  "http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd";
const xsiNamespace = "http://www.w3.org/2001/XMLSchema-instance";
/** Comprobante attributes that only the sealing block may add. */
export const sealAttributes = [
  "Sello",
  "NoCertificado",
  "Certificado",
] as const;

const attributes = (
  pairs: readonly [string, string | null][],
): XmlAttribute[] =>
  pairs.filter((pair): pair is [string, string] => pair[1] !== null);
const cfdi = (
  name: string,
  attrs: readonly [string, string | null][],
  children: readonly (XmlElement | null)[] = [],
): XmlElement => ({
  name: "cfdi:" + name,
  attributes: attributes(attrs),
  children: children.filter((c): c is XmlElement => c !== null),
});

const transfer = (t: Cfdi40Transfer) =>
  cfdi("Traslado", [
    ["Base", t.base],
    ["Impuesto", t.tax],
    ["TipoFactor", t.factor],
    ["TasaOCuota", t.rate],
    ["Importe", t.amount],
  ]);

function concept(c: Cfdi40Concept) {
  const taxes = c.taxes
    ? cfdi(
        "Impuestos",
        [],
        [
          c.taxes.transfers.length
            ? cfdi("Traslados", [], c.taxes.transfers.map(transfer))
            : null,
          c.taxes.withholdings.length
            ? cfdi(
                "Retenciones",
                [],
                c.taxes.withholdings.map((w) =>
                  cfdi("Retencion", [
                    ["Base", w.base],
                    ["Impuesto", w.tax],
                    ["TipoFactor", w.factor],
                    ["TasaOCuota", w.rate],
                    ["Importe", w.amount],
                  ]),
                ),
              )
            : null,
        ],
      )
    : null;
  return cfdi(
    "Concepto",
    [
      ["ClaveProdServ", c.productCode],
      ["NoIdentificacion", null],
      ["Cantidad", c.quantity],
      ["ClaveUnidad", c.unitCode],
      ["Unidad", null],
      ["Descripcion", c.description],
      ["ValorUnitario", c.unitPrice],
      ["Importe", c.amount],
      ["Descuento", c.discount],
      ["ObjetoImp", c.taxObject],
    ],
    [taxes],
  );
}

function summary(taxes: Cfdi40Taxes | null) {
  if (!taxes) return null;
  return cfdi(
    "Impuestos",
    [
      ["TotalImpuestosRetenidos", taxes.totalWithheld],
      ["TotalImpuestosTrasladados", taxes.totalTransferred],
    ],
    [
      taxes.withholdings.length
        ? cfdi(
            "Retenciones",
            [],
            taxes.withholdings.map((w) =>
              cfdi("Retencion", [
                ["Impuesto", w.tax],
                ["Importe", w.amount],
              ]),
            ),
          )
        : null,
      taxes.transfers.length
        ? cfdi("Traslados", [], taxes.transfers.map(transfer))
        : null,
    ],
  );
}

/** The element tree of the unsigned comprobante. */
export function cfdi40Tree(doc: Cfdi40Document): XmlElement {
  return cfdi(
    "Comprobante",
    [
      ["xmlns:cfdi", cfdi40Namespace],
      ["xmlns:xsi", xsiNamespace],
      ["xsi:schemaLocation", cfdi40SchemaLocation],
      ["Version", doc.version],
      ["Serie", doc.serie],
      ["Folio", doc.folio],
      ["Fecha", doc.issuedAt],
      // Sello: sealing block only.
      ["FormaPago", doc.paymentForm],
      // NoCertificado, Certificado: sealing block only. CondicionesDePago: not modeled.
      ["SubTotal", doc.subtotal],
      ["Descuento", doc.discount],
      ["Moneda", doc.currency],
      ["TipoCambio", doc.exchangeRate],
      ["Total", doc.total],
      ["TipoDeComprobante", doc.documentType],
      ["Exportacion", doc.exportCode],
      ["MetodoPago", doc.paymentMethod],
      ["LugarExpedicion", doc.placeOfIssue],
      // Confirmacion: not supported in v1.
    ],
    [
      cfdi("Emisor", [
        ["Rfc", doc.issuer.rfc],
        ["Nombre", doc.issuer.name],
        ["RegimenFiscal", doc.issuer.fiscalRegime],
      ]),
      cfdi("Receptor", [
        ["Rfc", doc.receiver.rfc],
        ["Nombre", doc.receiver.name],
        ["DomicilioFiscalReceptor", doc.receiver.fiscalAddressPostalCode],
        ["RegimenFiscalReceptor", doc.receiver.fiscalRegime],
        ["UsoCFDI", doc.receiver.cfdiUse],
      ]),
      cfdi("Conceptos", [], doc.concepts.map(concept)),
      summary(doc.taxes),
    ],
  );
}

type Parsed = Record<string, unknown>;
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  ignoreDeclaration: false,
});
function sameElement(expected: XmlElement, actual: Parsed): boolean {
  const names = Object.keys(actual).filter((k) => k !== ":@");
  if (names.length !== 1 || names[0] !== expected.name) return false;
  const attrs = Object.entries((actual[":@"] as Record<string, unknown>) ?? {});
  if (
    attrs.length !== expected.attributes.length ||
    attrs.some(([name, value], i) => {
      const [n, v] = expected.attributes[i];
      return name !== n || value !== v;
    })
  )
    return false;
  const children = actual[expected.name] as Parsed[];
  return (
    Array.isArray(children) &&
    children.length === expected.children.length &&
    children.every((child, i) => sameElement(expected.children[i], child))
  );
}
/**
 * Parses the XML back and compares names, attribute values and order, and child order with
 * the tree it came from. This proves the escaping round-trips; it is not XSD validation.
 */
export function roundTrips(xml: string, tree: XmlElement) {
  try {
    const parsed = parser.parse(xml) as Parsed[];
    return (
      parsed.length === 2 &&
      Object.keys(parsed[0]).includes("?xml") &&
      sameElement(tree, parsed[1])
    );
  } catch {
    return false;
  }
}

export function serializeUnsignedCfdi40(
  doc: Cfdi40Document,
): UnsignedCfdi40Xml {
  const tree = cfdi40Tree(doc);
  let xml: string;
  try {
    xml = serializeXml(tree);
  } catch (error) {
    if (error instanceof XmlSerializationError)
      throw new Cfdi40Error([
        cfdi40Issue("TEXT_INVALID_CHARACTER", "Comprobante", "ORBIT"),
      ]);
    throw error;
  }
  if (
    tree.attributes.some(([name]) =>
      (sealAttributes as readonly string[]).includes(name),
    ) ||
    !roundTrips(xml, tree)
  )
    throw new Cfdi40Error([
      cfdi40Issue("XML_ROUND_TRIP_MISMATCH", "Comprobante", "ORBIT"),
    ]);
  const bytes = new Uint8Array(Buffer.from(xml, "utf8"));
  return {
    stage: "UNSIGNED",
    xml,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
