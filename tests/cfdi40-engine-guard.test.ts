import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import cfdi40Manifest from "../src/lib/sat/cfdi40/manifest.json";
import nextConfig from "../next.config";
import { cfdi40XsltEngineId } from "../src/lib/cfdi40/xslt-engine";

// Fase 5C.5 dependency gate. The XSLT engine and its DOM were approved after an audit and a
// real-engine evidence suite (docs/tasks/FASE5C5-CADENA-ORIGINAL.md §6). If any value below
// changes (a new version, a different tarball, modified installed files, or new SAT XSLT
// resources), this test fails ON PURPOSE: repeat the audit, regenerate and re-verify the
// evidence (tests/cfdi40-cadena-engine.test.ts, two-engine references, seals), and only
// then update the pinned values together with the documentation.

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const pinned = {
  "@tradik/xslt-processor": {
    version: "1.3.4",
    integrity:
      "sha512-FPdxMwx15Hq6lq+ccwa0aDNJtKSmT62e3wThNFFgVMuBRBOYqrDwYX1W79Q0HZ0zE/UctpRnE5FvrLzOdIzcOg==",
    resolved:
      "https://registry.npmjs.org/@tradik/xslt-processor/-/xslt-processor-1.3.4.tgz",
    files: {
      "dist/xslt-processor.js":
        "53c2f7af6e7c9382dc4379f52fcf2a0e6f9f4c811a2845a9636689d0f00c48a4",
      "dist/xslt-processor.cjs":
        "8195f9b5d5af26f3fa21f36280e464f0306d85760151741178a8df30de6dae78",
      "package.json":
        "8cf70c0af00c1192f5988cdc447975cff5b6792ff717d41aba815fddaa58fd38",
    },
  },
  "@xmldom/xmldom": {
    version: "0.9.12",
    integrity:
      "sha512-5AXjrcMClTryPe9LgZrygpB1lj7s0S9E0+W+AHaVKAVyHanafK86iPSvG5xHVSp/jC+VH1UXu0TAEmY279xH7A==",
    resolved: "https://registry.npmjs.org/@xmldom/xmldom/-/xmldom-0.9.12.tgz",
    files: {
      "package.json":
        "b61c2dd342e0e1abb800302ec62c0b06ae7a07cd9b907c88428ff80100f64c6a",
    },
  },
} as const;
/** SHA-256 over the sorted "url sha256" lines of the cadena original XSLT and its includes. */
const satXsltFingerprint =
  "99f7ab6c9b4397ce5d7ef244eb9cd2b23c5561eebc97568c9168dce2d683576b";
const satXsltBundleSha256 =
  "36db26dbdc8bf1b2c470599662b99fcbb61b207f91f8f68517e039cb7fc3b844";
const xmldomLibFingerprint =
  "080945d5ec0ac3b8585657ab5e67e842b33cca8fa8d1837b37f1cd6487a9824f";

test("the approved XSLT engine and DOM are pinned to the audited versions and tarballs", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  for (const [name, expected] of Object.entries(pinned)) {
    assert.equal(
      manifest.dependencies[name],
      expected.version,
      `${name} exact in package.json`,
    );
    assert.equal(lock.packages[""].dependencies[name], expected.version);
    const entry = lock.packages["node_modules/" + name];
    assert.equal(entry.version, expected.version, name);
    assert.equal(entry.integrity, expected.integrity, name);
    assert.equal(entry.resolved, expected.resolved, name);
    assert.equal(
      entry.hasInstallScript ?? false,
      false,
      `${name} has no install script`,
    );
    assert.deepEqual(
      entry.dependencies ?? {},
      {},
      `${name} has no runtime dependencies`,
    );
    const installed = JSON.parse(
      await readFile(`node_modules/${name}/package.json`, "utf8"),
    );
    assert.equal(installed.version, expected.version, `${name} installed`);
    for (const [file, hash] of Object.entries(expected.files))
      assert.equal(
        sha256(await readFile(`node_modules/${name}/${file}`)),
        hash,
        `${name}/${file}`,
      );
  }
  const lib = (await readdir("node_modules/@xmldom/xmldom/lib"))
    .filter((file) => file.endsWith(".js"))
    .sort();
  const lines = await Promise.all(
    lib.map(
      async (file) =>
        `${file} ${sha256(await readFile("node_modules/@xmldom/xmldom/lib/" + file))}`,
    ),
  );
  assert.equal(
    sha256(lines.join("\n")),
    xmldomLibFingerprint,
    "@xmldom/xmldom/lib",
  );
  // Next/Vercel load the engine from node_modules as installed (the files hashed above), not a
  // re-bundled copy; this also keeps its lazy optional XSLT 3 import out of the build graph.
  assert.deepEqual(nextConfig.serverExternalPackages, [
    "@tradik/xslt-processor",
  ]);
  // Every cadena records exactly what produced it.
  assert.equal(
    cfdi40XsltEngineId,
    "@tradik/xslt-processor@1.3.4 (@xmldom/xmldom@0.9.12)",
  );
});

test("a new SAT XSLT version cannot be used without review", async () => {
  const lines = cfdi40Manifest.resources
    .filter((r) => r.kind === "XSLT" || r.kind === "XSLT_INCLUDE")
    .map((r) => `${r.url} ${r.sha256}`)
    .sort();
  assert.equal(lines.length, 34);
  assert.equal(sha256(lines.join("\n")), satXsltFingerprint);
  assert.equal(
    sha256(await readFile("src/lib/sat/cfdi40/cadenaoriginal-xslt.json")),
    satXsltBundleSha256,
  );
});
