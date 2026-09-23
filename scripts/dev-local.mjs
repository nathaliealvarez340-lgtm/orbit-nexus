import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { startDatabase } from "./local-database.mjs";
if (process.env.NODE_ENV === "production")
  throw new Error("dev:local is development only.");
const database = await startDatabase(true);
const port = process.env.PORT || "3100";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      DATABASE_URL: database.url,
      BETTER_AUTH_URL: "http://localhost:" + port,
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      NODE_USE_SYSTEM_CA: "1",
    },
  },
);
console.log("Base local privada iniciada. Abrir http://localhost:" + port);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill();
  await database.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", stop);
