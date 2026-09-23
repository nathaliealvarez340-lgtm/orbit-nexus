import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";

type XmlNode = Record<string, unknown>;
type Namespaces = Record<string, string>;
const cfdiNamespace = "http://www.sat.gob.mx/cfd/4";
const stampNamespace = "http://www.sat.gob.mx/TimbreFiscalDigital";
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);

function element(
  parent: XmlNode,
  localName: string,
  uri: string,
  inherited: Namespaces = {},
) {
  const matches = Object.entries(parent).flatMap(([name, value]) => {
    if (
      name.startsWith("@_") ||
      name.split(":").pop() !== localName ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      return [];
    const node = value as XmlNode;
    const namespaces = { ...inherited };
    for (const [key, val] of Object.entries(node)) {
      if (key === "@_xmlns" && typeof val === "string") namespaces[""] = val;
      if (key.startsWith("@_xmlns:") && typeof val === "string")
        namespaces[key.slice(8)] = val;
    }
    const prefix = name.includes(":") ? name.split(":")[0] : "";
    return namespaces[prefix] === uri ? [{ node, namespaces }] : [];
  });
  if (matches.length !== 1)
    throw new Error("Estructura o espacio de nombres del CFDI inválido.");
  return matches[0];
}

function readRoot(xml: string) {
  if (
    Buffer.byteLength(xml) > 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new Error("XML inválido o demasiado grande.");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: false,
    processEntities: false,
    parseAttributeValue: false,
    maxNestedTags: 50,
  }).parse(xml) as XmlNode;
  const root = element(parsed, "Comprobante", cfdiNamespace);
  if (root.node["@_Version"] !== "4.0")
    throw new Error("Se requiere un CFDI 4.0.");
  return root;
}

export function readCfdiReceiver(xml: string) {
  const root = readRoot(xml);
  const { node } = element(
    root.node,
    "Receptor",
    cfdiNamespace,
    root.namespaces,
  );
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_") && typeof value === "string")
      fields[key.slice(2)] = value;
  }
  if (!fields.Rfc) throw new Error("No se encontraron datos del receptor.");
  return fields;
}

export function parseCfdi(xml: string) {
  const root = readRoot(xml);
  if (
    root.node["@_Moneda"] !== "MXN" ||
    root.node["@_TipoDeComprobante"] !== "I"
  )
    throw new Error("Se requiere un CFDI de ingreso en MXN.");
  const issuer = element(
    root.node,
    "Emisor",
    cfdiNamespace,
    root.namespaces,
  ).node;
  const receiver = element(
    root.node,
    "Receptor",
    cfdiNamespace,
    root.namespaces,
  ).node;
  const complement = element(
    root.node,
    "Complemento",
    cfdiNamespace,
    root.namespaces,
  );
  const stamp = element(
    complement.node,
    "TimbreFiscalDigital",
    stampNamespace,
    complement.namespaces,
  ).node;
  const taxesPresent = Object.keys(root.node).some(
    (k) => !k.startsWith("@_") && k.split(":").pop() === "Impuestos",
  );
  const taxes = taxesPresent
    ? element(root.node, "Impuestos", cfdiNamespace, root.namespaces).node
    : {};
  const data = z
    .object({
      uuid: z.uuid().transform((v) => v.toLowerCase()),
      issuerRfc: z.string().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/),
      issuerName: z.string().min(1).max(200),
      receiverRfc: z.string().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/),
      total: amount,
      subtotal: amount,
      tax: amount,
      issuedAt: z.string().datetime({ local: true }),
    })
    .safeParse({
      uuid: stamp["@_UUID"],
      issuerRfc: issuer["@_Rfc"],
      issuerName: issuer["@_Nombre"],
      receiverRfc: receiver["@_Rfc"],
      total: root.node["@_Total"],
      subtotal: root.node["@_SubTotal"],
      tax: taxes["@_TotalImpuestosTrasladados"] ?? "0",
      issuedAt: root.node["@_Fecha"],
    });
  if (!data.success)
    throw new Error("Faltan datos válidos del CFDI o el timbre fiscal.");
  return data.data;
}
