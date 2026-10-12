import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { analyticsPath, sanitizeAnalytics } from "../src/lib/analytics-policy";
import {
  readCsdState,
  readCsdTerms,
  readCsdHistory,
  csdMessages,
  CsdUiError,
  csdTransport,
} from "../src/components/csd/transport";
import type { CsdState } from "../src/types/csd";
const marker = randomBytes(16).toString("hex");
test("CSD administration and API routes stay excluded from analytics even with consent", () => {
  for (const path of [
    "/dashboard/stamping",
    "/api/csd",
    "/api/csd/history",
    "/api/csd/custody-terms",
  ]) {
    assert.equal(analyticsPath(path), null);
    assert.equal(
      sanitizeAnalytics(
        { type: "pageview", url: "http://localhost:3101" + path },
        true,
        "http://localhost:3101",
      ),
      null,
    );
  }
});

const empty: CsdState = {
  id: null,
  status: "NOT_CONFIGURED",
  environment: null,
  invalidReason: null,
  expiresSoon: false,
  canManage: true,
  serviceAvailable: false,
  certificateNumber: null,
  rfc: null,
  validFrom: null,
  validTo: null,
  updatedAt: null,
  verification: null,
};
test("CSD boundary keeps only the safe shared DTO and rejects malformed success", () => {
  assert.deepEqual(
    readCsdState({ ...empty, password: marker, ciphertext: marker }),
    empty,
  );
  for (const malformed of [
    null,
    {},
    { ...empty, status: "VALIDATING" },
    { ...empty, status: "VALID" },
    { ...empty, serviceAvailable: "true" },
    { ...empty, updatedAt: "bad date" },
  ])
    assert.throws(() => readCsdState(malformed), CsdUiError);
});
test("CSD terms remain the exact backend version/text; history strips private extras", () => {
  assert.deepEqual(
    readCsdTerms({
      version: "draft-test",
      text: "Exact canonical text\n\nParagraph two",
      password: marker,
    }),
    { version: "draft-test", text: "Exact canonical text\n\nParagraph two" },
  );
  assert.throws(() => readCsdTerms({ version: "", text: "" }), CsdUiError);
  const row = {
    id: "test",
    status: "DISABLED",
    certificateNumber: "synthetic",
    rfc: "synthetic",
    environment: "SANDBOX",
    validFrom: "2026-01-01T00:00:00Z",
    validTo: "2027-01-01T00:00:00Z",
    configuredAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-02-01T00:00:00Z",
    configuredBy: "Synthetic owner",
  };
  assert.deepEqual(readCsdHistory([{ ...row, privateKey: marker }]), [row]);
  assert.throws(
    () => readCsdHistory([{ ...row, status: "ISSUED" }]),
    CsdUiError,
  );
  assert.throws(() => readCsdHistory(Array(51).fill(row)), CsdUiError);
});
test("all 23 published CSD errors have curated messages; raw server errors never reach UI", async () => {
  assert.equal(Object.keys(csdMessages).length, 23);
  const original = globalThis.fetch;
  try {
    for (const [code, message] of Object.entries(csdMessages)) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            code,
            error: "OpenSSL " + marker + " stack ASN.1",
          }),
          { status: 400 },
        );
      await assert.rejects(
        csdTransport.state(),
        (error: unknown) =>
          error instanceof CsdUiError && error.message === message,
      );
    }
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: "OpenSSL " + marker + " stack ASN.1" }),
        { status: 500 },
      );
    await assert.rejects(
      csdTransport.state(),
      (error: unknown) =>
        error instanceof CsdUiError && !error.message.includes(marker),
    );
  } finally {
    globalThis.fetch = original;
  }
});
