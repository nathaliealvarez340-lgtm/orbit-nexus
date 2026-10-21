import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { X509Certificate, createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { resolveCustody } from "../src/lib/csd/custody";
import { createSwPacAdapter } from "../src/lib/pac/sw/adapter";
import { resolveSwPacConfiguration } from "../src/lib/pac/sw/config";
import { reconcileStampAttempt } from "../src/services/cfdi40-stamp";
import type { InvoiceValidationResult } from "../src/types/invoice-studio";
import { startDatabase } from "../scripts/local-database.mjs";
import { issuedAt } from "./fixtures/cfdi40";
import {
  readMultipart,
  simulateStamp,
  stampingKit,
  swJson,
} from "./fixtures/stamping";
import { syntheticAuthority } from "./fixtures/synthetic-csd.mjs";

// Fase 5C.8 crash-safe PAC recovery (docs/tasks/FASE5C8-PAC-SANDBOX.md §21.3), across two real
// OS processes and one PERSISTENT PGlite directory (never Neon):
//   process A (tests/fixtures/stamp-crash-child.ts): authorization → attempt → seal → XSD →
//   bytes persisted → PAC receives the request → process A dies (no response, no finalize);
//   process B (this test): reopens the database, recovers the attempt with the SAME CustomID,
//   the SAME requestSha256 and byte-identical XML, and reconciles without rebuilding, re-dating
//   or re-sealing anything. The PAC is SIMULATED (SW's documented duplicate answers).

const b64url = () => randomBytes(24).toString("base64url");
const token = `${b64url()}.${b64url()}.${b64url()}`;
const kek = randomBytes(32).toString("base64");
const env = {
  PAC_ENVIRONMENT: "SANDBOX",
  STAMPING_ENABLED: "true",
  SW_SANDBOX_TOKEN: token,
  CSD_KEY_PROVIDER_SANDBOX: "env",
  CSD_KEK_ID: "orbit-crash-test",
  CSD_KEK_CURRENT_VERSION: "1",
  CSD_KEK_V1: kek,
};
const owner = {
  organizationId: "org-crash",
  userId: "owner-crash",
  role: "OWNER" as const,
};

test("crash after the PAC received the request: a new process recovers the exact persisted attempt and reconciles it with the same bytes and CustomID", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-crash-"));
  const dataDir = join(dir, "postgres");
  const receivedFile = join(dir, "received.json");
  try {
    // --- Process A: persists, submits, dies. -----------------------------------------------
    const child = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "tests/fixtures/stamp-crash-child.ts",
        dataDir,
        receivedFile,
      ],
      {
        // Never the real SW credentials or CSD paths.
        env: {
          ...process.env,
          ...Object.fromEntries(
            Object.keys(process.env)
              .filter((key) => /^SW_/i.test(key))
              .map((key) => [key, undefined]),
          ),
          CRASH_TEST_TOKEN: token,
          CRASH_TEST_KEK: kek,
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 180_000,
      },
    );
    assert.equal(child.status, 99, child.stderr);
    const received = JSON.parse(readFileSync(receivedFile, "utf8")) as {
      wellFormed: boolean;
      customId: string;
      sha256: string;
      xml: string;
    };
    assert(received.wellFormed);
    const receivedXml = Buffer.from(received.xml, "base64");

    // --- Process B: a new PGlite instance and a new Prisma client on the same directory. ---
    const database = await startDatabase(dataDir);
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: database.url, max: 5 }),
    });
    const sql = async (query: string, params: unknown[] = []) =>
      (await database.db.query(query, params)).rows as Record<
        string,
        unknown
      >[];
    try {
      const [attempt] = await prisma.stampAttempt.findMany({
        where: { organizationId: "org-crash", invoiceId: "inv-crash" },
      });
      assert(attempt, "the attempt survived the crash");
      assert.equal(attempt.status, "SUBMITTING");
      assert.equal(attempt.submissionCount, 1);
      assert.equal(attempt.customId, received.customId);
      assert.equal(attempt.customId, "orbit-" + attempt.id);
      assert.equal(attempt.requestSha256, received.sha256);
      assert(Buffer.from(attempt.sealedXml!).equals(receivedXml));
      assert.equal(
        createHash("sha256").update(attempt.sealedXml!).digest("hex"),
        attempt.requestSha256,
      );
      assert.equal(attempt.invoiceVersion, 1);
      const authorization = await prisma.stampAuthorization.findUniqueOrThrow({
        where: { id: attempt.authorizationId },
      });
      assert.deepEqual(
        [authorization.invoiceId, authorization.invoiceVersion],
        ["inv-crash", 1],
      );

      // The recovery evidence is immutable in the database itself.
      for (const [statement, params, problem] of [
        [
          `UPDATE "StampAttempt" SET "customId"=$1 WHERE id=$2`,
          ["orbit-other", attempt.id],
          "IDENTITY",
        ],
        [
          `UPDATE "StampAttempt" SET "invoiceVersion"=2 WHERE id=$1`,
          [attempt.id],
          "IDENTITY",
        ],
        [
          `UPDATE "StampAttempt" SET "sealedXml"=$1, "requestSha256"=$2 WHERE id=$3`,
          [
            Buffer.from("x"),
            createHash("sha256").update("x").digest("hex"),
            attempt.id,
          ],
          "REQUEST",
        ],
        [
          `UPDATE "StampAttempt" SET "submissionCount"=0 WHERE id=$1`,
          [attempt.id],
          "SUBMISSIONS",
        ],
        [
          `DELETE FROM "StampAttempt" WHERE id=$1`,
          [attempt.id],
          "SUBMITTED_NOT_DELETABLE",
        ],
        [
          `UPDATE "StampAuthorization" SET "invoiceVersion"=2 WHERE id=$1`,
          [attempt.authorizationId],
          "AUTHORIZATION_IMMUTABLE",
        ],
      ] as const)
        await assert.rejects(
          database.db.query(statement, [...params]),
          new RegExp(problem),
          statement,
        );

      // Reconciliation from the recovered state: the SIMULATED PAC stamped the first request.
      const kit = await stampingKit();
      const earlier = simulateStamp(kit, {
        xml: receivedXml.toString("utf8"),
      });
      const calls: { customId: string | null; xml: Buffer }[] = [];
      let answer: "uuid-only" | "full" = "uuid-only";
      const pac = createSwPacAdapter(resolveSwPacConfiguration(env), {
        transport: async (_url, init) => {
          const parts = readMultipart(init);
          assert(parts.wellFormed);
          calls.push({ customId: parts.customId, xml: Buffer.from(parts.xml) });
          return swJson(400, {
            message:
              "CFDI3307 - Timbre duplicado. El customId proporcionado está duplicado.",
            messageDetail: null,
            data: answer === "full" ? earlier.data : { uuid: earlier.uuid },
            status: "error",
          });
        },
      });
      const authority = syntheticAuthority();
      const deps = {
        env,
        // Ten minutes later: the SUBMITTING attempt is stale and may have reached the PAC.
        clock: () => new Date(issuedAt.getTime() + 10 * 60_000),
        custody: resolveCustody(env, [
          new X509Certificate(authority.certificate),
        ]),
        pac,
        revalidate: async () =>
          ({
            canMarkReady: true,
            issues: [],
          }) as unknown as InvoiceValidationResult,
      };
      // SW v4 duplicate CustomID with only the UUID: never enough to call it stamped.
      const pending = await reconcileStampAttempt(
        prisma,
        owner,
        "inv-crash",
        deps,
      );
      assert.equal(pending.attempt.status, "UNKNOWN");
      assert.equal(pending.attempt.error?.code, "PAC_DUPLICATE_CUSTOM_ID");
      // The duplicate with the earlier stamp: verified against the recovered bytes.
      answer = "full";
      const resolved = await reconcileStampAttempt(
        prisma,
        owner,
        "inv-crash",
        deps,
      );
      assert.equal(resolved.attempt.status, "SUCCEEDED");
      assert.equal(resolved.attempt.id, attempt.id);
      assert.deepEqual(
        [resolved.invoice.status, resolved.invoice.uuid],
        ["READY", null],
      );
      // Every re-submission: the recovered bytes and CustomID, never rebuilt.
      assert.equal(calls.length, 2);
      for (const call of calls) {
        assert.equal(call.customId, received.customId);
        assert(call.xml.equals(receivedXml));
      }
      const rows = await prisma.stampAttempt.findMany({
        where: { invoiceId: "inv-crash" },
      });
      assert.equal(rows.length, 1, "one logical attempt");
      const [final] = rows;
      assert.equal(final.uuid, earlier.uuid.toLowerCase());
      assert.equal(final.resultCode, "PAC_DUPLICATE_CUSTOM_ID");
      // One logical attempt, three HTTP submissions (the lost one and two reconciliations).
      assert.equal(final.submissionCount, 3);
      assert.equal(final.requestSha256, received.sha256);
      assert(Buffer.from(final.sealedXml!).equals(receivedXml));
      // The verified stamp is immutable too.
      await assert.rejects(
        database.db.query(`UPDATE "StampAttempt" SET uuid=NULL WHERE id=$1`, [
          final.id,
        ]),
        /STAMP_ATTEMPT_STAMP_IMMUTABLE/,
      );
      assert.equal(
        (await sql(`SELECT COUNT(*)::int n FROM "StampAuthorization"`))[0].n,
        1,
      );
      const dump = JSON.stringify(await sql(`SELECT * FROM "AuditEvent"`));
      assert(!dump.includes(token) && !dump.includes(kek));
    } finally {
      await prisma.$disconnect();
      await database.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
