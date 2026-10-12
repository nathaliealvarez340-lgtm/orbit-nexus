import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import manifest from "@/lib/sat/cfdi40/manifest.json";
import { Cfdi40Error, cfdi40Issue } from "./errors";

// Fase 5C.4: official CFDI 4.0 resources versioned in resources/sat/cfdi40 (never downloaded
// at runtime). Every read is checked against the SHA-256 of
// src/lib/sat/cfdi40/manifest.json; a missing or modified file is an error, never a
// fallback. A manifest path that leaves resources/sat/cfdi40 or names another file is
// rejected before touching the filesystem. Bundling these files into a serverless function
// (output file tracing) is part of wiring the XSD/XSLT gates, not of this block.

export type Cfdi40ResourceName =
  "cfdv40.xsd" | "tdCFDI.xsd" | "catCFDI.xsd" | "cadenaoriginal_4_0.xslt";

export const cfdi40ResourceDirectory = "resources/sat/cfdi40";

type ManifestEntry = (typeof manifest.resources)[number];
const stored = (name: string) =>
  manifest.resources.find(
    (r): r is ManifestEntry & { stored: string } =>
      r.name === name && typeof r.stored === "string",
  );

/**
 * Absolute path of a versioned resource, or null when `stored` is absolute, escapes the
 * resources directory (.., symbolic segments, other drive) or does not end in `name`.
 */
export function cfdi40ResourcePath(
  name: string,
  storedPath: string,
  root: string,
): string | null {
  if (path.isAbsolute(storedPath) || storedPath.includes("\\")) return null;
  const directory = path.resolve(root, cfdi40ResourceDirectory);
  const resolved = path.resolve(root, storedPath);
  return path.dirname(resolved) === directory &&
    path.basename(resolved) === name
    ? resolved
    : null;
}

export async function readCfdi40Resource(
  name: Cfdi40ResourceName,
  root = process.cwd(),
): Promise<Buffer> {
  const entry = stored(name);
  if (!entry)
    throw new Cfdi40Error([cfdi40Issue("SAT_RESOURCE_MISSING", name, "ORBIT")]);
  const file = cfdi40ResourcePath(name, entry.stored, root);
  if (!file)
    throw new Cfdi40Error([
      cfdi40Issue("SAT_RESOURCE_PATH_INVALID", name, "ORBIT"),
    ]);
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    throw new Cfdi40Error([cfdi40Issue("SAT_RESOURCE_MISSING", name, "ORBIT")]);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw new Cfdi40Error([cfdi40Issue("SAT_RESOURCE_CORRUPT", name, "ORBIT")]);
  return bytes;
}

/** Hash check of every stored resource; reports, never throws. */
export async function verifyCfdi40Resources(root = process.cwd()) {
  return Promise.all(
    manifest.resources
      .filter((r) => typeof r.stored === "string")
      .map(async (r) => {
        try {
          await readCfdi40Resource(r.name as Cfdi40ResourceName, root);
          return { name: r.name, ok: true as const };
        } catch (error) {
          return {
            name: r.name,
            ok: false as const,
            code:
              error instanceof Cfdi40Error
                ? error.issues[0].code
                : "SAT_RESOURCE_MISSING",
          };
        }
      }),
  );
}
