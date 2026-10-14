import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import cfdi40Manifest from "../src/lib/sat/cfdi40/manifest.json";
import { cfdi40XsdEngineId } from "../src/lib/cfdi40/xsd-engine";

// Fase 5C.7 dependency gate. The XSD engine was chosen after an audit, an isolated POC and an
// independent comparison (docs/tasks/FASE5C7-XSD-VALIDATION.md §5). If any value below changes
// (another version or tarball, modified installed files — including the embedded libxml2 — or
// a new official XSD), this test fails ON PURPOSE: repeat the audit (libxml2 version and its
// CVEs, network/fs/eval review), re-run the XSD suites and the .NET comparison, then update
// the pinned values together with the documentation.

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const pinned = {
  version: "0.7.2",
  integrity:
    "sha512-Ek8Fdb8fIl6mBCvrMGImkOP02aDpANwus0PV827v4gobV9jnoYEHNoPTwWokt71egUBl+sng53fjZ5y2PexLqQ==",
  resolved: "https://registry.npmjs.org/libxml2-wasm/-/libxml2-wasm-0.7.2.tgz",
  files: {
    "package.json":
      "dba5cd44cb281925385c98a3e08babfca945fbfe62b993f5d035d67b4f03918d",
    // JavaScript glue with the embedded WebAssembly build of libxml2 2.15.1.
    "lib/libxml2raw.mjs":
      "df6c8801906c0dad66e0da3db8c3849e3e8528246db513de4d4716cb82792d2e",
    "LICENSE.libxml2":
      "d6b46c48dcbf7204714abe0d162dd81ba88f3a97b5fe69bab8ea03ad8d515a6b",
  },
  /** SHA-256 over the sorted "file sha256" lines of lib/*.mjs. */
  libFingerprint:
    "78ddd7dec53db11332d0942db74c3df17dcf3f790f22856ea3ec363d91668e1e",
} as const;
/** SHA-256 over the sorted "url sha256" lines of the official XSD set. */
const satXsdFingerprint =
  "d99667dd2664e51e34d0880d1acf370838a857fc6c810c83b09beaf95d9ee2af";
const satXsdBundleSha256 =
  "19c885462b648e3f8d059811dd1a54d662f97f919cdd78de95e22832a3142bb1";

test("the XSD engine is pinned to the audited version, tarball and installed files", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.equal(manifest.dependencies["libxml2-wasm"], pinned.version);
  assert.equal(lock.packages[""].dependencies["libxml2-wasm"], pinned.version);
  const entry = lock.packages["node_modules/libxml2-wasm"];
  assert.equal(entry.version, pinned.version);
  assert.equal(entry.integrity, pinned.integrity);
  assert.equal(entry.resolved, pinned.resolved);
  assert.equal(entry.license, "MIT");
  assert.equal(entry.hasInstallScript ?? false, false, "no install script");
  assert.deepEqual(entry.dependencies ?? {}, {}, "no runtime dependencies");
  for (const [file, hash] of Object.entries(pinned.files))
    assert.equal(
      sha256(await readFile(`node_modules/libxml2-wasm/${file}`)),
      hash,
      file,
    );
  const lib = (await readdir("node_modules/libxml2-wasm/lib"))
    .filter((file) => file.endsWith(".mjs"))
    .sort();
  const lines = await Promise.all(
    lib.map(
      async (file) =>
        `${file} ${sha256(await readFile("node_modules/libxml2-wasm/lib/" + file))}`,
    ),
  );
  assert.equal(sha256(lines.join("\n")), pinned.libFingerprint, "lib/*.mjs");
  // No separate .wasm or native binary: everything the runtime needs is in lib/*.mjs.
  assert.deepEqual(
    (await readdir("node_modules/libxml2-wasm/lib")).filter((f) =>
      /\.(wasm|node|so|dll|dylib)$/.test(f),
    ),
    [],
  );
  // Every validated CFDI records exactly what validated it.
  assert.equal(cfdi40XsdEngineId, "libxml2-wasm@0.7.2 (libxml2 2.15.1)");
});

test("a new official SAT XSD cannot be used without review", async () => {
  const lines = cfdi40Manifest.resources
    .filter((r) => r.kind === "XSD")
    .map((r) => `${r.url} ${r.sha256}`)
    .sort();
  assert.equal(lines.length, 3);
  assert.equal(sha256(lines.join("\n")), satXsdFingerprint);
  assert.equal(
    sha256(await readFile("src/lib/sat/cfdi40/cfdv40-xsd.json")),
    satXsdBundleSha256,
  );
});
