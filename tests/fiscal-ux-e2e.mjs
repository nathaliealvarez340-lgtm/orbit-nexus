import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { startDatabase } from "../scripts/local-database.mjs";
import { fiscalUxChecks } from "./fiscal-ux-checks.mjs";

// Actual app/API scenarios use only ephemeral PGlite and synthetic local data.
const database = await startDatabase();
const baseURL = "http://localhost:3101";
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3101",
  ],
  {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL: "",
      DATABASE_URL: database.url,
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      MAIL_API_URL: "",
      MAIL_API_TOKEN: "",
      OCR_API_URL: "",
      OCR_API_TOKEN: "",
    },
  },
);
let logs = "",
  browser;
app.stdout.on("data", (chunk) => {
  logs += chunk;
});
app.stderr.on("data", (chunk) => {
  logs += chunk;
});
const checks = [],
  errors = [];
const pass = (message) => {
  checks.push(message);
  console.log("PASS " + message);
};
await mkdir("test-results", { recursive: true });
try {
  for (let index = 0; index < 120 && !logs.includes("Ready in"); index++) {
    if (app.exitCode !== null) throw new Error("Local server failed to start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(logs.includes("Ready in"));
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === "win32" ? "msedge" : undefined,
  });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const post = async (path, data, status = 200) => {
    const response = await context.request.post(path, {
      headers: { Origin: baseURL },
      data,
    });
    assert.equal(response.status(), status, await response.text());
    return response.json();
  };
  await post("/api/auth/sign-up/email", {
    name: "Fiscal UX QA",
    email: "fiscal-ux@example.test",
    password: randomBytes(24).toString("base64url") + "-9aZ",
  });
  const org = await post(
    "/api/organizations",
    { name: "Fiscal UX isolated QA" },
    201,
  );
  await database.db.query(
    'INSERT INTO "Subscription" ("organizationId",plan,"updatedAt") VALUES ($1,$2,NOW())',
    [org.id, "PRO"],
  );
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("SYNTHETIC LOCAL CSF FOR TEST ONLY");
  const uploaded = await context.request.post("/api/private-assets", {
    headers: { Origin: baseURL },
    multipart: {
      kind: "CSF",
      file: {
        name: "local-test.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      },
    },
  });
  assert.equal(uploaded.status(), 201);
  const csf = await uploaded.json();
  await post("/api/fiscal-profile", {
    rfc: "AAA010101AAA",
    legalName: "Emisor local de prueba",
    fiscalRegime: "601",
    personType: "COMPANY",
    cfdiUse: "G03",
    postalCode: "06000",
    email: "issuer@example.test",
    country: "MEX",
    confirmed: true,
    csfDocumentId: csf.id,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Rechazar no esenciales" }).click();
  await fiscalUxChecks({ page, context, pass });
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/fiscal-ux-e2e-summary.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        browserErrors: errors,
        boundary:
          "real local application APIs; CSF extraction fixtures only in separate in-memory UI harness; no PAC or ISSUED",
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    "test-results/fiscal-ux-e2e-summary.json",
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  await writeFile("test-results/fiscal-ux-server.log", logs);
  throw error;
} finally {
  await browser?.close();
  if (app.exitCode === null) {
    if (process.platform === "win32")
      execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else app.kill();
    if (app.exitCode === null)
      await new Promise((resolve) => app.once("exit", resolve));
  }
  await database.close();
}
