import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  precreationCsfDocumentId,
  precreationCsfExpired,
  precreationCsfExpiresAt,
  precreationCsfReference,
  precreationCsfTtlMs,
} from "../src/lib/csf/precreation";

// Client CSF before the client exists (docs/tasks/CLIENT-CSF-PRECREATION.md): the opaque
// reference and the lifecycle limits. The end-to-end flow is tests/client-csf-precreation-e2e.mjs.

const env = { BETTER_AUTH_SECRET: randomBytes(32).toString("hex") };
const session = { organizationId: "org-a", userId: "user-a" };
const binding = { ...session, documentId: "cmdocument000001" };

test("the reference is bound to Organization, user and document and cannot be forged", () => {
  const reference = precreationCsfReference(binding, env);
  assert.match(reference, /^v1\.cmdocument000001\.[A-Za-z0-9_-]{43}$/);
  assert.equal(precreationCsfReference(binding, env), reference);
  assert.equal(
    precreationCsfDocumentId(reference, session, env),
    binding.documentId,
  );
  // It carries no Organization or user identifier in clear.
  assert(!reference.includes("org-a") && !reference.includes("user-a"));
  // Another tenant, another user of the same tenant or another key: not usable.
  for (const other of [
    { organizationId: "org-b", userId: "user-a" },
    { organizationId: "org-a", userId: "user-c" },
  ])
    assert.equal(precreationCsfDocumentId(reference, other, env), null);
  assert.equal(
    precreationCsfDocumentId(reference, session, {
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    }),
    null,
  );
  // Swapping the document, altering the signature or the format is refused.
  const [, , signature] = reference.split(".");
  const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  for (const forged of [
    `v1.cmdocument000002.${signature}`,
    `v1.cmdocument000001.${flipped}`,
    `v2.cmdocument000001.${signature}`,
    `v1.cmdocument000001.${signature}.x`,
    `v1..${signature}`,
    "v1.cmdocument000001",
    "",
    "cmdocument000001",
    `v1.../${signature}`,
  ])
    assert.equal(precreationCsfDocumentId(forged, session, env), null, forged);
  assert.throws(
    () => precreationCsfReference(binding, {}),
    /AUTH_NOT_CONFIGURED/,
  );
  assert.throws(
    () => precreationCsfReference({ ...binding, documentId: "../x" }, env),
    /INVALID_DOCUMENT_ID/,
  );
});

test("a pre-creation CSF expires 24 hours after upload", () => {
  const createdAt = new Date("2026-10-12T10:00:00.000Z");
  assert.equal(precreationCsfTtlMs, 24 * 60 * 60 * 1000);
  assert.equal(
    precreationCsfExpiresAt(createdAt).toISOString(),
    "2026-10-13T10:00:00.000Z",
  );
  assert.equal(
    precreationCsfExpired(createdAt, new Date("2026-10-13T09:59:59.999Z")),
    false,
  );
  assert.equal(
    precreationCsfExpired(createdAt, new Date("2026-10-13T10:00:00.000Z")),
    true,
  );
});

test("pre-creation CSF code never logs or returns the document contents", async () => {
  for (const file of [
    "src/lib/csf/precreation.ts",
    "src/services/client-csf-precreation.ts",
  ]) {
    const text = await readFile(file, "utf8");
    assert(!/console\.(log|info|warn|debug)/.test(text), file);
    assert(!/content\s*:\s*true/.test(text), file);
  }
});
