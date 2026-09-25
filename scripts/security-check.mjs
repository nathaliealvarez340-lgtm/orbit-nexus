import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Exact existing synthetic password fixtures; never exempt an entire test file.
// Changing a fixture requires reviewing its new fingerprint here.
const fixturePasswords = new Map([
  [
    "scripts/auth-e2e.mjs",
    new Set([
      "5ff1eb8d43b9a09b36730ec704cc55c24589caa58ba8efa874af67b1ea397eb8",
    ]),
  ],
  [
    "scripts/e2e.mjs",
    new Set([
      "e8d9559c286ce720c0a80f4e3392566a82ecde357d5e4ecff8e774cbd4e9e457",
      "aab976f4a7b33e249f1c8ecc3858b49f2d8cba75723f3f1731b1dce70e66de4f",
    ]),
  ],
  [
    "tests/auth.test.ts",
    new Set([
      "e8d9559c286ce720c0a80f4e3392566a82ecde357d5e4ecff8e774cbd4e9e457",
      "f9b0078b5df596d2ea19010c001bbd009e651de2c57e8fb7e355f31eb9d3f739",
    ]),
  ],
]);

// Exact existing synthetic loopback connections; fingerprints avoid embedding URLs here.
const fixtureConnections = new Map([
  [
    "scripts/local-database.mjs",
    "3de972c98bf6eb192f31d3cc1403df37662eb200a8a85f5d5594a1c5bf1933a6",
  ],
  [
    "prisma.config.ts",
    "129bd7662868ae3a0bd3fa65d2c237e183ef2e29aebb61511fe82c513b57d18c",
  ],
]);

const patterns = [
  [
    "clave privada",
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  ],
  ["secreto Stripe", /\b(?:[sr]k_(?:live|test)_|whsec_)[A-Za-z0-9]{16,}\b/],
  ["API key Resend", /\bre_[A-Za-z0-9_]{24,}\b/],
  [
    "token GitHub",
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  ],
  ["API key de IA", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/],
  ["credencial AWS", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["API key Google", /\bAIza[\w-]{30,}\b/],
  ["secreto OAuth", /\bGOCSPX-[\w-]{20,}\b/],
  ["token Slack", /\bxox[baprs]-[\w-]{16,}\b/],
  ["token npm", /\bnpm_[A-Za-z0-9]{30,}\b/],
  ["API key SendGrid", /\bSG\.[\w-]{16,}\.[\w-]{16,}\b/],
  ["JWT", /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/],
];

function placeholder(value) {
  return (
    !value ||
    /^(?:<[A-Z][A-Z0-9_ -]*>|(?:YOUR|REPLACE|CHANGE|GENERATE)_[A-Z0-9_]+)$/.test(
      value,
    )
  );
}

function sensitiveName(key) {
  return /(?:secret|secretkey|token|jwt|password|passwd|pgpassword|apikey|privatekey|accesskey|authorization)$/.test(
    key.replace(/[_-]/g, "").toLowerCase(),
  );
}

function fixturePassword(file, key, value) {
  return (
    key === "password" &&
    fixturePasswords
      .get(file)
      ?.has(createHash("sha256").update(value).digest("hex"))
  );
}

export function fileRisk(file) {
  const name = basename(file).toLowerCase();
  if (
    name !== ".env.example" &&
    (name.startsWith(".env") || /\.env(?:\.|$)/.test(name))
  )
    return "archivo de entorno sensible";
  if (
    /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(name) ||
    /^id_(?:rsa|ed25519)$/.test(name)
  )
    return "archivo de clave o certificado privado";
  if (
    /\.(?:sql|dump|backup|bak)(?:\.(?:gz|zip))?$/.test(name) &&
    !/^prisma\/migrations\/(?:[^/]+\/)+migration\.sql$/.test(file)
  )
    return "dump o respaldo";
  if (/\.log(?:\.|$)/.test(name) || file.startsWith("logs/"))
    return "log local";
  if (
    /^(?:credentials.*|client_secret.*|service-account.*|.*-service-account|application_default_credentials)\.json$/.test(
      name,
    ) ||
    /^secrets.*\.(?:tmp|txt|json)$/.test(name) ||
    /(?:^|\/)(?:\.secrets|\.credentials|credentials|\.aws|\.azure|\.gcloud|\.ssh|\.vercel|\.orbit-local|test-results|playwright-report)\//.test(
      file,
    ) ||
    /(?:^|\/)\.config\/gcloud\//.test(file) ||
    [".netrc", "_netrc", ".pgpass", "pgpass.conf", ".npmrc.local"].includes(
      name,
    )
  )
    return "credenciales o estado privado de herramientas";
  return undefined;
}

function inspectTemplate(text, risks) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(
      /^([A-Z][A-Z0-9_]*)\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#"']*))\s*(?:#.*)?$/,
    );
    if (!match) {
      risks.add("formato no permitido en plantilla de entorno");
      continue;
    }
    const [, key, double, single, bare] = match;
    const value = double ?? single ?? bare;
    if (placeholder(value)) continue;
    if (
      key === "BETTER_AUTH_URL" &&
      /^http:\/\/localhost(?::\d{1,5})?\/?$/.test(value)
    )
      continue;
    risks.add("valor no vacío ni placeholder seguro en plantilla de entorno");
  }
}

export function inspectContent(file, content) {
  const risks = new Set();
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : content;
  const template = basename(file) === ".env.example";
  // Check even binary blobs for embedded obvious credentials; no secret output.
  for (const [type, pattern] of patterns)
    if (pattern.test(text)) risks.add(type);
  for (const match of text.matchAll(
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s"'`<>]+/gi,
  )) {
    const value = match[0];
    // Existing loopback-only PGlite fixture and Prisma's inert local fallback.
    if (
      !template &&
      fixtureConnections.get(file) ===
        createHash("sha256").update(value).digest("hex")
    )
      continue;
    if (/^[a-z+]+:\/\/[^/@]*:[^/@]+@/i.test(value))
      risks.add("conexión de base de datos con credenciales");
  }
  for (const match of text.matchAll(
    /(?:^|[\s,{;])(?:["']?)([A-Za-z_$][\w$]*)(?:["']?)\s*[:=]\s*(["'`])((?:\\.|(?!\2)[^\\\r\n])*?)\2/gm,
  )) {
    const [, key, , value] = match;
    if (
      !sensitiveName(key) ||
      placeholder(value) ||
      value.includes("${") ||
      fixturePassword(file, key, value)
    )
      continue;
    if (
      key.toLowerCase() === "authorization" &&
      /^(?:Bearer|Basic)\s*$/.test(value)
    )
      continue;
    risks.add("credencial literal en configuración o código");
  }
  // Unquoted assignments in dotenv, YAML, shell and similar configuration.
  for (const line of text.split(/\r?\n/)) {
    // Unquoted JS/TS values are expressions; literal strings were checked above.
    if (/\.[cm]?[jt]sx?$/.test(file)) break;
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][\w-]*)\s*[:=]\s*([^\s"'`#][^\r\n]*?)\s*$/,
    );
    if (!match || !sensitiveName(match[1])) continue;
    const value = match[2].replace(/\s+#.*$/, "").trim();
    if (
      placeholder(value) ||
      /^(?:process\.env\.|env\(|os\.environ|\$\{|\$[A-Za-z_]|null\b|undefined\b)/.test(
        value,
      )
    )
      continue;
    risks.add("credencial literal en configuración o código");
  }
  if (template) inspectTemplate(text, risks);
  return [...risks];
}

export function checkRepository(cwd = process.cwd()) {
  const git = (args, input) =>
    execFileSync("git", args, {
      cwd,
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
  const root = git(["rev-parse", "--show-toplevel"]).toString().trim();
  cwd = root;
  const findings = new Map();
  const report = (file, type) =>
    findings.set(JSON.stringify([file, type]), { file, type });
  const inspect = (file, data) => {
    const risk = fileRisk(file);
    if (risk) report(file, risk);
    for (const type of inspectContent(file, data)) report(file, type);
  };
  const entries = git(["ls-files", "--stage", "-z"])
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/);
      if (!match) throw new Error("INDEX_UNREADABLE");
      return { mode: match[1], oid: match[2], stage: match[3], file: match[4] };
    });
  if (!entries.some(({ file }) => file === ".env.example"))
    report(".env.example", "plantilla no versionada");
  for (const entry of entries) {
    if (entry.stage !== "0") report(entry.file, "conflicto en índice Git");
    if (!/^100(?:644|755)$/.test(entry.mode))
      report(entry.file, "enlace o submódulo requiere revisión");
  }
  // Read staged bytes, not just working files: cleaning a working copy must not hide a staged secret.
  const ids = [
    ...new Set(
      entries.filter(({ mode }) => mode !== "160000").map(({ oid }) => oid),
    ),
  ];
  const batch = ids.length
    ? git(["cat-file", "--batch"], ids.join("\n") + "\n")
    : Buffer.alloc(0);
  const blobs = new Map();
  let offset = 0;
  while (offset < batch.length) {
    const end = batch.indexOf(10, offset);
    if (end < 0) throw new Error("OBJECT_UNREADABLE");
    const [oid, type, size] = batch.subarray(offset, end).toString().split(" ");
    const length = Number(size);
    if (
      type !== "blob" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      end + length + 1 >= batch.length
    )
      throw new Error("OBJECT_UNREADABLE");
    blobs.set(oid, batch.subarray(end + 1, end + 1 + length));
    offset = end + length + 2;
  }
  for (const { file, oid, mode } of entries)
    if (mode !== "160000") inspect(file, blobs.get(oid));
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
    .toString()
    .split("\0")
    .filter(Boolean);
  const files = new Set([...entries.map(({ file }) => file), ...untracked]);
  for (const file of files) {
    try {
      const target = join(root, file);
      const stat = lstatSync(target);
      if (!stat.isFile()) {
        report(file, "enlace o submódulo requiere revisión");
        continue;
      }
      if (stat.size > 16 * 1024 * 1024) {
        report(file, "archivo demasiado grande para inspección");
        continue;
      }
      inspect(file, readFileSync(target));
    } catch (error) {
      if (error.code !== "ENOENT")
        report(file, "archivo no legible para inspección");
    }
  }
  return { findings: [...findings.values()], files: files.size };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = checkRepository();
    for (const { file, type } of result.findings)
      console.error(`${JSON.stringify(file)} — ${type}`);
    if (result.findings.length) process.exitCode = 1;
    else
      console.log(
        `Security check OK: índice Git y ${result.files} archivos locales revisados.`,
      );
  } catch {
    // Never print raw Git/filesystem exceptions: they may include file contents.
    console.error('"." — no se pudo completar la inspección Git de seguridad');
    process.exitCode = 1;
  }
}
