// Fase 5C.4: the only XML writer for CFDI. Elements and attributes come from a typed tree;
// names are checked, every attribute value goes through one escaping function and the
// output has no indentation or whitespace between elements, so the same tree always gives
// the same bytes. CFDI 4.0 uses attributes only, so text nodes are not supported.

export type XmlAttribute = readonly [name: string, value: string];
export type XmlElement = {
  readonly name: string;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlElement[];
};

export const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>';

export class XmlSerializationError extends Error {
  constructor(
    public readonly reason:
      "INVALID_NAME" | "INVALID_CHARACTER" | "DUPLICATE_ATTRIBUTE",
  ) {
    super(reason);
    this.name = "XmlSerializationError";
  }
}

const qualifiedName = /^[A-Za-z_][A-Za-z0-9._-]*(:[A-Za-z_][A-Za-z0-9._-]*)?$/;
// Anything outside the XML 1.0 Char production (also lone surrogates, with the u flag).
const invalidCharacter =
  /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  // Escaped so attribute-value normalization cannot turn them into spaces.
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};

export function escapeAttribute(value: string) {
  if (invalidCharacter.test(value))
    throw new XmlSerializationError("INVALID_CHARACTER");
  return value.replace(/[&<>"\t\n\r]/g, (c) => entities[c]);
}

function element(node: XmlElement): string {
  if (!qualifiedName.test(node.name))
    throw new XmlSerializationError("INVALID_NAME");
  const names = new Set<string>();
  let out = "<" + node.name;
  for (const [name, value] of node.attributes) {
    if (!qualifiedName.test(name))
      throw new XmlSerializationError("INVALID_NAME");
    if (names.has(name)) throw new XmlSerializationError("DUPLICATE_ATTRIBUTE");
    names.add(name);
    out += ` ${name}="${escapeAttribute(value)}"`;
  }
  if (!node.children.length) return out + "/>";
  return out + ">" + node.children.map(element).join("") + `</${node.name}>`;
}

/** UTF-8 document: declaration immediately followed by the root element; no trailing newline. */
export function serializeXml(root: XmlElement) {
  return xmlDeclaration + element(root);
}
