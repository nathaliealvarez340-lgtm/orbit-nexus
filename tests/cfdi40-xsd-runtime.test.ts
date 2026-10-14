import assert from "node:assert/strict";
import { before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { buildUnsignedCfdi40 } from "../src/lib/cfdi40/build";
import { loadCfdi40Catalogs } from "../src/lib/cfdi40/catalogs";
import { issuedAt, validFixtures } from "./fixtures/cfdi40";
import { syntheticAuthority, syntheticCsd } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.7 (Vercel/serverless): the production path pre-seal → official cadena → signature →
// sealed → official XSD, bundled as a server function would be, runs in an empty directory —
// no resources/, no node_modules, network blocked — and every CFDI validates. The XSD set and
// the libxml2 WebAssembly travel inside the bundle; nothing is read from disk or downloaded.

const entry = `
import { createPrivateKey } from "node:crypto";
import { serializePreSealCfdi40 } from "@/lib/cfdi40/serialize";
import { generateOfficialCfdi40OriginalString, cfdi40XsltEngine } from "@/lib/cfdi40/xslt-engine";
import { compileCfdi40Xslt } from "@/lib/cfdi40/original-string";
import { loadCfdi40XsltBundle } from "@/lib/cfdi40/xslt-resources";
import { createSealedCfdi40 } from "@/lib/cfdi40/sealed";
import { signCfdiSeal } from "@/lib/csd/signing";
import { cfdi40XsdProblems } from "@/lib/cfdi40/schema";
import { loadCfdi40XsdEngine, validateOfficialSealedCfdi40Xsd } from "@/lib/cfdi40/xsd-engine";
import { loadCfdi40XsdBundle } from "@/lib/cfdi40/xsd-resources";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  const { pkcs8, certificate, cases } = JSON.parse(input);
  const key = createPrivateKey({ key: Buffer.from(pkcs8, "base64"), format: "der", type: "pkcs8" });
  const stylesheet = compileCfdi40Xslt(cfdi40XsltEngine, await loadCfdi40XsltBundle());
  const results = [];
  let last = "";
  for (const document of cases) {
    const preSeal = serializePreSealCfdi40(document, certificate);
    const cadena = await generateOfficialCfdi40OriginalString(preSeal);
    const sealed = createSealedCfdi40(preSeal, cadena, signCfdiSeal(key, cadena.bytes).toString("base64"), stylesheet);
    const validated = await validateOfficialSealedCfdi40Xsd(sealed);
    results.push({ stage: validated.stage, same: validated.sha256 === sealed.sha256, engine: validated.xsd.engine });
    last = sealed.xml;
  }
  const deps = { engine: await loadCfdi40XsdEngine(), bundle: await loadCfdi40XsdBundle() };
  const invalid = cfdi40XsdProblems(last.replace(' Moneda="MXN"', ' Moneda="ZZZ"'), deps).map((i) => i.code);
  process.stdout.write(JSON.stringify({ results, invalid, bundleSha256: deps.bundle.bundleSha256, blocked: globalThis.__orbitBlocked }));
});
`;
// Network and file reads of SAT resources are refused/recorded before the bundle loads.
const preload = `
const net = require("node:net");
const dns = require("node:dns");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
globalThis.__orbitBlocked = [];
const block = (label) => function () {
  globalThis.__orbitBlocked.push(label);
  throw new Error("BLOCKED " + label);
};
globalThis.fetch = block("fetch");
net.Socket.prototype.connect = block("net.connect");
dns.lookup = block("dns.lookup");
http.request = block("http.request");
https.request = block("https.request");
for (const name of ["readFileSync", "readFile", "openSync", "open", "createReadStream"]) {
  const original = fs[name];
  fs[name] = function (path, ...rest) {
    if (/resources|\\.xsd|node_modules/i.test(String(path))) globalThis.__orbitBlocked.push("fs." + name);
    return original.call(this, path, ...rest);
  };
}
`;

let directory = "";
let bundle = "";
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "orbit-xsd-runtime-"));
  await build({
    stdin: {
      contents: entry,
      resolveDir: process.cwd(),
      sourcefile: "xsd-runtime-entry.ts",
      loader: "ts",
    },
    tsconfig: "tsconfig.json",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    conditions: ["react-server"],
    // Optional peer of @tradik/xslt-processor (XSLT 3), never installed or used.
    external: ["@tradik/xslt3"],
    // libxml2-wasm instantiates its WebAssembly with top-level await and is loaded with
    // import(): split chunks keep that as a real ES module import (as Next.js does), instead
    // of a lazy initializer that cannot await.
    splitting: true,
    outdir: directory,
    entryNames: "xsd",
    outExtension: { ".js": ".mjs" },
    logLevel: "silent",
  });
  await writeFile(join(directory, "preload.cjs"), preload);
  for (const file of await readdir(directory))
    if (file.endsWith(".mjs"))
      bundle += await readFile(join(directory, file), "utf8");
});

test("the bundled seal + official XSD path runs without resources/, node_modules or network", async () => {
  // Only the generated chunks and the preload: no node_modules, no resources/.
  const files = (await readdir(directory)).sort();
  assert(files.includes("xsd.mjs") && files.includes("preload.cjs"));
  for (const file of files)
    assert(file === "preload.cjs" || /^[\w-]+\.mjs$/.test(file), file);
  assert(!bundle.includes("PrismaClient"), "no database client");
  assert(
    bundle.includes(
      "http://www.sat.gob.mx/sitio_internet/cfd/catalogos/catCFDI.xsd",
    ),
  );
  // The manifest (data) names the stored files, but the module that reads them from disk is
  // not part of this path; the preload below also records any such read at runtime.
  assert(
    !bundle.includes("readCfdi40Resource"),
    "no code that reads resources/ from disk",
  );
  const catalogs = await loadCfdi40Catalogs();
  const csd = syntheticCsd(syntheticAuthority(), {
    certificateNumber: "30001000000000000001",
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validTo: new Date("2036-01-01T00:00:00Z"),
  });
  const names = Object.keys(validFixtures) as (keyof typeof validFixtures)[];
  const input = {
    pkcs8: (
      csd.keyObject.export({ type: "pkcs8", format: "der" }) as Buffer
    ).toString("base64"),
    certificate: {
      noCertificado: "30001000000000000001",
      certificadoBase64: Buffer.from(csd.certificate).toString("base64"),
    },
    cases: names.map(
      (name) =>
        buildUnsignedCfdi40(validFixtures[name].invoice(), {
          issuedAt,
          catalogs,
        }).document,
    ),
  };
  const run = spawnSync(
    process.execPath,
    ["--require", "./preload.cjs", "./xsd.mjs"],
    {
      cwd: directory,
      input: JSON.stringify(input),
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "", "nothing written to the console");
  const output = JSON.parse(run.stdout) as {
    results: { stage: string; same: boolean; engine: string }[];
    invalid: string[];
    bundleSha256: string;
    blocked: string[];
  };
  assert.deepEqual(output.blocked, []);
  assert.equal(output.results.length, names.length);
  for (const result of output.results)
    assert.deepEqual(result, {
      stage: "XSD_VALIDATED",
      same: true,
      engine: "libxml2-wasm@0.7.2 (libxml2 2.15.1)",
    });
  assert.deepEqual(output.invalid, ["CFDI_XSD_INVALID"]);
  assert.match(output.bundleSha256, /^[0-9a-f]{64}$/);
  let size = 0;
  for (const file of files) size += (await stat(join(directory, file))).size;
  assert(size < 40 * 1024 * 1024, `bundle ${size} bytes`);
});
