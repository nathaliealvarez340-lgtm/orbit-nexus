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

// Fase 5C.5 (Vercel/serverless): the production cadena original path, bundled as a function
// would be, runs in an empty directory — no resources/, no node_modules, network blocked —
// and still produces the reference cadenas byte for byte. The official XSLT travels inside the
// bundle (verified by hash at runtime); nothing is read from disk or downloaded.

const fixtures = "tests/fixtures/cfdi40/cadena";
const entry = `
import { serializePreSealCfdi40 } from "@/lib/cfdi40/serialize";
import { generateOfficialCfdi40OriginalString } from "@/lib/cfdi40/xslt-engine";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  const values = [];
  for (const { document, certificate } of JSON.parse(input))
    values.push((await generateOfficialCfdi40OriginalString(serializePreSealCfdi40(document, certificate))).value);
  process.stdout.write(JSON.stringify({ values, blocked: globalThis.__orbitBlocked }));
});
`;
// Network is refused and recorded before the bundle loads.
const preload = `
const net = require("node:net");
const dns = require("node:dns");
globalThis.__orbitBlocked = [];
const block = (label) => function () {
  globalThis.__orbitBlocked.push(label);
  throw new Error("BLOCKED " + label);
};
globalThis.fetch = block("fetch");
net.Socket.prototype.connect = block("net.connect");
dns.lookup = block("dns.lookup");
`;

let directory = "";
let bundle = "";
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "orbit-cadena-runtime-"));
  await build({
    stdin: {
      contents: entry,
      resolveDir: process.cwd(),
      sourcefile: "cadena-runtime-entry.ts",
      loader: "ts",
    },
    tsconfig: "tsconfig.json",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    conditions: ["react-server"],
    // Optional peer of @tradik/xslt-processor, imported only for xsltVersion "auto" (XSLT 3),
    // which ORBIT never uses; it is not installed and must never load.
    external: ["@tradik/xslt3"],
    outfile: join(directory, "cadena.mjs"),
    logLevel: "silent",
  });
  await writeFile(join(directory, "preload.cjs"), preload);
  bundle = await readFile(join(directory, "cadena.mjs"), "utf8");
});

test("the bundled cadena original runs without resources/, node_modules or network", async () => {
  assert.deepEqual((await readdir(directory)).sort(), [
    "cadena.mjs",
    "preload.cjs",
  ]);
  // Only the cadena path is bundled: no database client, no CSD custody.
  assert(
    !bundle.includes("PrismaClient"),
    "no Prisma client in the cadena runtime",
  );
  assert(!/openPrivateKey|unwrapDataKey/.test(bundle), "no private-key code");
  assert(
    !/from\s*"@tradik\/xslt3"/.test(bundle),
    "XSLT 3 is never imported statically",
  );
  assert(
    bundle.includes(
      "http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xslt",
    ),
  );
  const catalogs = await loadCfdi40Catalogs();
  const certificate = {
    noCertificado: "30001000000000000001",
    certificadoBase64: (
      await readFile(join(fixtures, "synthetic-seal-certificate.cer"))
    ).toString("base64"),
  };
  const names = Object.keys(validFixtures) as (keyof typeof validFixtures)[];
  const cases = names.map((name) => ({
    document: buildUnsignedCfdi40(validFixtures[name].invoice(), {
      issuedAt,
      catalogs,
    }).document,
    certificate,
  }));
  const run = spawnSync(
    process.execPath,
    ["--require", "./preload.cjs", "./cadena.mjs"],
    {
      cwd: directory,
      input: JSON.stringify(cases),
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "", "nothing written to the console");
  const { values, blocked } = JSON.parse(run.stdout) as {
    values: string[];
    blocked: string[];
  };
  assert.deepEqual(blocked, []);
  for (const [index, name] of names.entries())
    assert.equal(
      values[index],
      await readFile(join(fixtures, "orbit", name + ".cadena.txt"), "utf8"),
      name,
    );
  const size = (await stat(join(directory, "cadena.mjs"))).size;
  assert(size < 5 * 1024 * 1024, `bundle ${size} bytes`);
});
