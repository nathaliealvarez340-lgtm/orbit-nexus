import { spawn } from "node:child_process";
import { startDatabase } from "./local-database.mjs";
const database = await startDatabase();
try {
  // Only remove the test harness ledger from the isolated, in-memory database.
  await database.db.exec('DROP TABLE "_orbit_local_migrations"');
  const child = spawn(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
    ],
    {
      windowsHide: true,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: database.url + "?sslmode=disable" },
    },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  process.exitCode = code ?? 1;
} finally {
  await database.close();
}
