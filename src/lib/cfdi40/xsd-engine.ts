import "server-only";
import type { ErrorDetail } from "libxml2-wasm";
import {
  validateSealedCfdi40Xsd,
  type Cfdi40XmlNode,
  type Cfdi40XsdDiagnostic,
  type Cfdi40XsdEngine,
} from "./schema";
import { stampedCfdi40XsdSet } from "./stamped-schema";
import type { StampedVerificationDeps } from "./stamped";
import { loadTfd11Bundle } from "./tfd-resources";
import { cfdi40XsltEngine } from "./xslt-engine";
import { loadCfdi40XsdBundle } from "./xsd-resources";
import type { SealedCfdi40Xml, XsdValidatedCfdi40 } from "./types";

// Fase 5C.7: the XSD engine (docs/tasks/FASE5C7-XSD-VALIDATION.md §5): libxml2 2.15.1 compiled
// to WebAssembly by libxml2-wasm, pinned to an exact version (tests/cfdi40-xsd-guard.test.ts).
// In process, no native binary, no worker, no network: the WebAssembly has no sockets and its
// file system is an empty in-memory one, so a reference outside the bundle cannot be read.
// On top of that, the only input provider serves the verified XSD bundle, and only while a
// schema is being compiled; any other request is refused, recorded and fails validation.
// Documents are parsed with XML_PARSE_NONET and without entity substitution, DTD loading or
// XInclude (and ./schema.ts rejects any DOCTYPE first). libxml2 messages are classified by
// ./schema.ts and never surfaced; no console output is produced
//
// libxml2-wasm is an ES module that instantiates its WebAssembly with top-level await, so it
// is loaded with import() (once) instead of a static import that CommonJS callers could not
// require.

export const cfdi40XsdEngineId = "libxml2-wasm@0.7.2 (libxml2 2.15.1)";
type Libxml2 = typeof import("libxml2-wasm");

const diagnostics = (
  details: readonly ErrorDetail[],
  stage: Cfdi40XsdDiagnostic["stage"],
): Cfdi40XsdDiagnostic[] =>
  details.map((d) => ({
    stage,
    message: String(d.message ?? ""),
    line: d.line,
    column: d.col,
    xpath: d.xpath,
  }));

function createEngine(lib: Libxml2): Cfdi40XsdEngine {
  const parseOptions = lib.ParseOption.XML_PARSE_NONET;
  let loader: ((url: string) => Uint8Array | null) | null = null;
  const strays: string[] = [];
  const files = new Map<number, { data: Uint8Array; offset: number }>();
  let nextFile = 1;
  lib.xmlRegisterInputProvider({
    match(name) {
      if (!loader) {
        strays.push(name);
        return false;
      }
      return loader(name) !== null;
    },
    open(name) {
      const data = loader?.(name);
      if (!data) return undefined;
      const handle = nextFile++;
      files.set(handle, { data, offset: 0 });
      return handle;
    },
    read(handle, buffer) {
      const file = files.get(handle);
      if (!file) return -1;
      const count = Math.min(buffer.byteLength, file.data.length - file.offset);
      buffer.set(file.data.subarray(file.offset, file.offset + count));
      file.offset += count;
      return count;
    },
    close(handle) {
      files.delete(handle);
      return true;
    },
  });
  return {
    id: cfdi40XsdEngineId,
    compile(root, load) {
      loader = load;
      let validator: InstanceType<Libxml2["XsdValidator"]>;
      try {
        // The schema document stays alive with its validator (compiled once per process).
        const schema = lib.XmlDocument.fromBuffer(root.bytes, {
          url: root.url,
          option: parseOptions,
        });
        validator = lib.XsdValidator.fromDoc(schema);
      } finally {
        loader = null;
      }
      // The element tree of a validated document (Fase 5C.8), copied out before dispose.
      const treeOf = (
        element: InstanceType<Libxml2["XmlElement"]>,
        depth = 0,
      ): Cfdi40XmlNode => {
        if (depth > 32) throw new Error("XSD_TREE_TOO_DEEP");
        const children: Cfdi40XmlNode[] = [];
        let text = false;
        for (let node = element.firstChild; node; node = node.next) {
          if (node instanceof lib.XmlElement)
            children.push(treeOf(node, depth + 1));
          else if (node.content.trim()) text = true;
        }
        return Object.freeze({
          namespace: element.namespaceUri,
          name: element.name,
          attributes: Object.freeze(
            element.attrs.map((attribute) =>
              Object.freeze({
                namespace: attribute.namespaceUri,
                name: attribute.name,
                value: attribute.value,
              }),
            ),
          ),
          children: Object.freeze(children),
          text,
        });
      };
      const run = (bytes: Uint8Array, withTree: boolean) => {
        const before = strays.length;
        let document: InstanceType<Libxml2["XmlDocument"]>;
        try {
          document = lib.XmlDocument.fromBuffer(bytes, {
            option: parseOptions,
          });
        } catch (error) {
          if (error instanceof lib.XmlParseError)
            return {
              diagnostics: diagnostics(error.details, "PARSE"),
              tree: null,
            };
          throw error;
        }
        try {
          if (document.warnings.length)
            return {
              diagnostics: diagnostics(document.warnings, "PARSE"),
              tree: null,
            };
          try {
            validator.validate(document);
          } catch (error) {
            if (error instanceof lib.XmlValidateError)
              return {
                diagnostics: diagnostics(error.details, "VALIDATE"),
                tree: null,
              };
            if (error instanceof lib.XmlLibError)
              throw new Error("XSD_ENGINE_ERROR");
            throw error;
          }
          // Validating must not ask for any resource.
          if (strays.length !== before)
            throw new Error("XSD_UNEXPECTED_RESOURCE");
          return {
            diagnostics: [] as Cfdi40XsdDiagnostic[],
            tree: withTree ? treeOf(document.root) : null,
          };
        } finally {
          document.dispose();
        }
      };
      return {
        validate: (bytes) => run(bytes, false).diagnostics,
        inspect: (bytes) => run(bytes, true),
      };
    },
  };
}

let engine: Promise<Cfdi40XsdEngine> | undefined;
/** The approved engine behind the Cfdi40XsdEngine port, loaded once. */
export function loadCfdi40XsdEngine(): Promise<Cfdi40XsdEngine> {
  return (engine ??= import("libxml2-wasm").then(createEngine));
}

/**
 * The production XSD gate: the exact bytes of a CFDI sealed by ORBIT against the official SAT
 * XSD set (versioned, hash-verified bundle) with the approved engine. No database, network,
 * files or secrets.
 */
export async function validateOfficialSealedCfdi40Xsd(
  sealed: SealedCfdi40Xml,
): Promise<XsdValidatedCfdi40> {
  const [xsdEngine, bundle] = await Promise.all([
    loadCfdi40XsdEngine(),
    loadCfdi40XsdBundle(),
  ]);
  return validateSealedCfdi40Xsd(sealed, { engine: xsdEngine, bundle });
}

let stampedDeps: Promise<StampedVerificationDeps> | undefined;
/**
 * Fase 5C.8: the official dependencies to verify a PAC response (./stamped.ts): this engine,
 * the cfdv40 + TFD 1.1 XSD set and the official TFD cadena XSLT with the approved XSLT engine.
 */
export function loadStampedVerificationDeps(): Promise<StampedVerificationDeps> {
  stampedDeps ??= Promise.all([
    loadCfdi40XsdEngine(),
    loadCfdi40XsdBundle(),
    loadTfd11Bundle(),
  ]).then(([engine, cfdi, tfd]) => ({
    engine,
    set: stampedCfdi40XsdSet(cfdi, tfd),
    xslt: { engine: cfdi40XsltEngine, tfd },
  }));
  return stampedDeps.catch((error) => {
    stampedDeps = undefined;
    throw error;
  });
}
