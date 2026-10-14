// Maintainer tool (Fase 5C.7): downloads the official CFDI 4.0 resources for REVIEW. Never
// run by the application, never writes to resources/ or src/.
//
//   node scripts/sat/fetch-cfdi40-resources.mjs --out <new empty dir> [--only XSD|XSLT|all]
//
// - Allowlist: exactly the URLs of src/lib/sat/cfdi40/manifest.json. Anything a downloaded
//   XSD (xs:import/include/redefine/override) or XSLT (xsl:include/import) references that is
//   not in the allowlist stops the run: a new dependency needs a human decision first.
// - HTTPS for the download (the manifest keeps the official http:// URLs as identifiers);
//   redirects are refused; status 200, Content-Length and a size limit are enforced.
// - Writes <out>/<name> and <out>/<name>.headers (Last-Modified, ETag), the layout that
//   build-cfdi40-resources.mjs reads, and prints a hash diff against the manifest.
// - SAT update gate: a changed hash is reported, never applied. Review the diff, the imports
//   and compatibility, run the tests, then build-cfdi40-resources.mjs --dir <out> --replace,
//   commit and deploy. A new hash without that review is an error, not an update.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--"))
      pairs.push([
        value.slice(2),
        all[index + 1]?.startsWith("--") ? true : (all[index + 1] ?? true),
      ]);
    return pairs;
  }, []),
);
if (typeof args.out !== "string")
  throw new Error("Missing --out <new empty directory>");
const only = typeof args.only === "string" ? args.only.toUpperCase() : "ALL";
if (!["ALL", "XSD", "XSLT"].includes(only))
  throw new Error("--only must be XSD, XSLT or all");
const out = path.resolve(args.out);
const repository = path.resolve(".");
if (out === repository || out.startsWith(repository + path.sep))
  throw new Error("--out must be outside the repository");
if (existsSync(out) && readdirSync(out).length)
  throw new Error("--out must be empty");

const manifest = JSON.parse(
  readFileSync("src/lib/sat/cfdi40/manifest.json", "utf8"),
);
const allowed = new Map(manifest.resources.map((r) => [r.url, r]));
const selected = manifest.resources.filter((r) =>
  only === "ALL"
    ? true
    : only === "XSD"
      ? r.kind === "XSD"
      : r.kind === "XSLT" || r.kind === "XSLT_INCLUDE",
);
const maxBytes = 20 * 1024 * 1024;
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Official http:// URL → the https:// URL used to download it (same host and path). */
function downloadUrl(official) {
  const url = new URL(official);
  if (
    url.protocol !== "http:" ||
    !/^(www|omawww)\.sat\.gob\.mx$/.test(url.host) ||
    url.search ||
    url.hash
  )
    throw new Error("Not an allowlisted SAT URL: " + official);
  url.protocol = "https:";
  return url.href;
}
const references = (text) => [
  ...[
    ...text.matchAll(
      /<xs:(?:import|include|redefine|override)\b[^>]*?\bschemaLocation="([^"]+)"/g,
    ),
  ].map((m) => m[1]),
  ...[...text.matchAll(/<xsl:(?:include|import)\s+href="([^"]+)"/g)].map(
    (m) => m[1],
  ),
];

mkdirSync(out, { recursive: true });
const unknown = [];
let changed = 0;
for (const entry of selected) {
  const response = await fetch(downloadUrl(entry.url), {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status !== 200)
    throw new Error(`${entry.name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  // fetch decodes gzip/deflate transparently: Content-Length then counts the encoded body.
  const encoded = !["", "identity"].includes(
    response.headers.get("content-encoding") ?? "",
  );
  const length = Number(response.headers.get("content-length"));
  if (
    bytes.length > maxBytes ||
    (!encoded && Number.isFinite(length) && length !== bytes.length)
  )
    throw new Error(`${entry.name}: unexpected size`);
  const file = path.join(out, ...entry.name.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes, { flag: "wx" });
  writeFileSync(
    file + ".headers",
    ["Last-Modified", "ETag", "Content-Type"]
      .map((name) => `${name}: ${response.headers.get(name) ?? ""}`)
      .join("\r\n") + "\r\n",
    { flag: "wx" },
  );
  const digest = sha256(bytes);
  const same = digest === entry.sha256;
  if (!same) changed++;
  console.log(
    (same ? "unchanged" : "CHANGED  ").padEnd(10),
    entry.name,
    same
      ? digest.slice(0, 12)
      : `${entry.sha256.slice(0, 12)} -> ${digest.slice(0, 12)} (${entry.bytes} -> ${bytes.length} bytes)`,
    "|",
    response.headers.get("last-modified") ?? "",
  );
  if (
    entry.kind === "XSD" ||
    entry.kind === "XSLT" ||
    entry.kind === "XSLT_INCLUDE"
  )
    for (const reference of references(bytes.toString("utf8")))
      if (!allowed.has(reference))
        unknown.push(`${entry.name} -> ${reference}`);
}
if (unknown.length) {
  console.error(
    "Unknown references (not allowlisted; review before adding):\n  " +
      unknown.join("\n  "),
  );
  process.exitCode = 2;
}
console.log(
  `${selected.length} downloaded to ${out}; ${changed} changed. Nothing was applied.`,
);
