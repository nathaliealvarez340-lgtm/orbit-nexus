import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fileRisk, inspectContent } from "../scripts/security-check.mjs";

const script = fileURLToPath(
  new URL("../scripts/security-check.mjs", import.meta.url),
);
const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
const sentinel = [
  "SYNTHETIC",
  "ONLY",
  "NEVER",
  "A",
  "REAL",
  "CREDENTIAL",
  "2026",
].join("_");
const connection = [
  "postgresql:",
  "",
  `fixture:${sentinel}@db.example.test/fixture`,
].join("/");
const assignment = (name: string, value: string) =>
  [name, JSON.stringify(value)].join(" = ");

function fixture(
  run: (repo: {
    dir: string;
    track: (file: string, text: string) => void;
    write: (file: string, text: string) => void;
    check: () => ReturnType<typeof spawnSync>;
  }) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-security-"));
  const git = (args: string[], input?: string) =>
    execFileSync("git", args, {
      cwd: dir,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  const track = (file: string, text: string) => {
    write(file, text);
    // Only this disposable repository's index is populated. No git add/commit or network.
    const oid = git(["hash-object", "-w", "--stdin"], text);
    git(["update-index", "--add", "--cacheinfo", "100644", oid, file]);
  };
  try {
    git(["init", "--quiet"]);
    track(".env.example", assignment("DATABASE_URL", "") + "\n");
    track(".gitignore", ignore);
    run({
      dir,
      track,
      write,
      check: () =>
        spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }),
    });
  } finally {
    // Verify the resolved deletion target stays inside the OS temporary directory.
    const target = resolve(dir);
    assert(
      target.startsWith(resolve(tmpdir()) + sep) &&
        basename(target).startsWith("orbit-security-"),
    );
    rmSync(target, { recursive: true, force: true });
  }
}

function rejectsWithoutValue(
  result: ReturnType<typeof spawnSync>,
  file: string,
  value = sentinel,
) {
  const output = String(result.stdout) + String(result.stderr);
  assert.equal(result.status, 1);
  assert(
    output.includes(JSON.stringify(file)),
    "diagnostic identifies the file",
  );
  assert(
    !output.includes(value),
    "diagnostic must never contain the credential",
  );
}

test("security CLI checks staged bytes after the working file is cleaned or deleted", () => {
  fixture(({ dir, track, write, check }) => {
    assert.equal(check().status, 0);
    track("config.ts", "const " + assignment("clientSecret", sentinel));
    write("config.ts", "export {};\n");
    rejectsWithoutValue(check(), "config.ts");
    unlinkSync(join(dir, "config.ts"));
    rejectsWithoutValue(check(), "config.ts");
  });
});

test("security CLI catches modified tracked and new untracked files, then passes after cleanup", () => {
  fixture(({ dir, track, write, check }) => {
    track("config.ts", "export {};\n");
    write("config.ts", "const " + assignment("apiKey", sentinel));
    rejectsWithoutValue(check(), "config.ts");
    write("config.ts", "export {};\n");
    write("temporary-probe.txt", assignment("BETTER_AUTH_SECRET", sentinel));
    rejectsWithoutValue(check(), "temporary-probe.txt");
    unlinkSync(join(dir, "temporary-probe.txt"));
    assert.equal(check().status, 0);
  });
});

test("ignored local env is not read but a force-tracked env is rejected", () => {
  fixture(({ track, write, check }) => {
    write(".env", assignment("DATABASE_URL", connection));
    assert.equal(check().status, 0);
    track(".env", assignment("DATABASE_URL", connection));
    rejectsWithoutValue(check(), ".env");
  });
});

test("template must remain in the index and contain only safe configuration", () => {
  fixture(({ dir, track, check }) => {
    track(".env.example", assignment("BETTER_AUTH_SECRET", sentinel));
    rejectsWithoutValue(check(), ".env.example");
    execFileSync("git", ["update-index", "--force-remove", ".env.example"], {
      cwd: dir,
    });
    rejectsWithoutValue(check(), ".env.example");
  });
  const safe = [
    assignment("DATABASE_URL", ""),
    assignment("BETTER_AUTH_SECRET", "<GENERATE_RANDOM_SECRET>"),
    assignment("BETTER_AUTH_URL", "http://localhost:3000"),
  ].join("\n");
  assert.deepEqual(inspectContent(".env.example", safe), []);
  for (const key of [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "OAUTH_CLIENT_SECRET",
    "PASSWORD",
    "UNRECOGNIZED_SETTING",
  ])
    assert(
      inspectContent(".env.example", assignment(key, sentinel)).length > 0,
    );
});

test("secret families and hardcoded credentials are detected without returning values", () => {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const samples = [
    connection,
    connection.toUpperCase(),
    ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
    "sk_" + "live_" + "SYNTHETIC".repeat(5),
    "whsec_" + "SYNTHETIC".repeat(5),
    "re_" + "SYNTHETIC".repeat(5),
    "ghp_" + "SYNTHETIC".repeat(5),
    "GOCSPX-" + "SYNTHETIC".repeat(5),
    "sk-proj-" + "SYNTHETIC".repeat(5),
    "AKIA" + "SYNTHETICONLYKEY",
    "AIza" + "SYNTHETIC".repeat(5),
    "npm_" + "SYNTHETIC".repeat(5),
    "xoxb-" + "SYNTHETIC".repeat(5),
    [
      header,
      Buffer.from(sentinel).toString("base64url"),
      "SYNTHETIC_SIGNATURE",
    ].join("."),
  ];
  for (const sample of samples) {
    const risks = inspectContent("sample.txt", sample);
    assert(risks.length > 0, "synthetic credential family must be detected");
    assert(
      !JSON.stringify(risks).includes(sample),
      "results contain risk categories only",
    );
  }
  for (const key of [
    "apiKey",
    "password",
    "accessToken",
    "clientSecret",
    "BETTER_AUTH_SECRET",
    "PRIVATE_KEY",
  ])
    assert(
      inspectContent("config.ts", "const " + assignment(key, sentinel)).length >
        0,
    );
  assert(
    inspectContent("config.yml", ["client_secret", sentinel].join(": "))
      .length > 0,
  );
  assert(
    inspectContent(
      "tests/auth.test.ts",
      "const " + assignment("password", sentinel),
    ).length > 0,
    "tests are not broadly exempted",
  );
});

test("sensitive artifacts are blocked while migration SQL is inspected normally", () => {
  const names = [
    ".env",
    ".env.local",
    ".env.test",
    ".env.production",
    ".env.development",
    ".env.production.local.old",
    "app.env.production",
    "auth.pem",
    "auth.key",
    "auth.p12",
    "auth.pfx",
    "db.sql",
    "db.dump",
    "db.backup",
    "db.bak",
    "db.sql.gz",
    "db.backup.zip",
    "debug.log",
    "credentials-download.json",
    ".vercel/project.json",
  ];
  for (const file of names) assert(fileRisk(file), file);
  for (const file of [
    ".env.example",
    "prisma/migrations/202601010001_init/migration.sql",
    "prisma/migrations/archive/init/migration.sql",
    "src/lib/db.ts",
    "prisma/schema.prisma",
  ])
    assert.equal(fileRisk(file), undefined, file);
  assert(
    inspectContent("prisma/migrations/init/migration.sql", connection).length >
      0,
  );
  fixture(({ dir, track, check }) => {
    track(
      "prisma/migrations/init/migration.sql",
      'CREATE TABLE "Fixture" ("id" TEXT);',
    );
    assert.equal(check().status, 0);
    for (const file of names) {
      const result = spawnSync(
        "git",
        ["check-ignore", "--no-index", "--quiet", "--", file],
        { cwd: dir },
      );
      assert.equal(result.status, 0, file);
    }
    for (const file of [
      ".env.example",
      "prisma/migrations/init/migration.sql",
      "prisma/migrations/archive/init/migration.sql",
      "scripts/security-check.mjs",
      "prisma/schema.prisma",
      "README.md",
    ]) {
      const result = spawnSync(
        "git",
        ["check-ignore", "--no-index", "--quiet", "--", file],
        { cwd: dir },
      );
      assert.equal(result.status, 1, file);
    }
    track("export.sql", "-- synthetic dump placeholder");
    rejectsWithoutValue(check(), "export.sql");
  });
});
