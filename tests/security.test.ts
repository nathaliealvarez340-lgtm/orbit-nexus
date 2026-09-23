import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { validateUpload, MAX_UPLOAD_BYTES } from "../src/lib/upload-validation";
import {
  expenseSchema,
  fiscalSchema,
  passwordSchema,
} from "../src/lib/validation";
import { parseConsent } from "../src/lib/consent";
import { resolveInvoiceProvider } from "../src/services/invoice-provider/assisted";
import { getTicketOcrAdapter } from "../src/services/ocr/adapter";
import { parseCfdi } from "../src/lib/cfdi";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDioAAAAASUVORK5CYII=",
  "base64",
);
test("uploads validate extension, MIME, signature, size and safe names", async () => {
  const valid = await validateUpload(
    new File([png], "../../ticket.png", { type: "image/png" }),
  );
  assert(!valid.fileName.includes("/"));
  await assert.rejects(() =>
    validateUpload(new File([png], "ticket.pdf", { type: "application/pdf" })),
  );
  await assert.rejects(() =>
    validateUpload(new File(["html"], "ticket.png", { type: "image/png" })),
  );
  await assert.rejects(() =>
    validateUpload(new File([png], "ticket.svg", { type: "image/svg+xml" })),
  );
  await assert.rejects(() =>
    validateUpload(
      new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "ticket.png", {
        type: "image/png",
      }),
    ),
  );
  await assert.rejects(() =>
    validateUpload(
      new File(
        ["<!DOCTYPE x [<!ENTITY a SYSTEM 'file:///etc/passwd'>]><x/>"],
        "fiscal.xml",
        { type: "application/xml" },
      ),
      true,
    ),
  );
});
test("confirmation requires actual date and positive exact money", () => {
  assert(
    expenseSchema.safeParse({
      merchant: "OXXO",
      purchaseDate: "2026-02-28",
      total: "120.50",
    }).success,
  );
  for (const total of ["0", "-1", "10.001", "1e5", "NaN"])
    assert(
      !expenseSchema.safeParse({
        merchant: "OXXO",
        purchaseDate: "2026-02-28",
        total,
      }).success,
    );
  assert(
    !expenseSchema.safeParse({
      merchant: "OXXO",
      purchaseDate: "2026-02-30",
      total: "10",
    }).success,
  );
});
test("password and fiscal confirmation are validated", () => {
  assert(!passwordSchema.safeParse("12345678").success);
  assert(passwordSchema.safeParse("OrbitTest2026!").success);
  assert(
    !fiscalSchema.safeParse({
      rfc: "XAXX010101000",
      legalName: "Usuario",
      fiscalRegime: "616",
      postalCode: "06600",
      cfdiUse: "G03",
      email: "test@example.com",
      personType: "COMPANY",
      confirmed: true,
    }).success,
  );
});
test("consent validates individual optional categories and never disables necessary cookies", () => {
  assert.equal(parseConsent("optional"), null);
  assert.equal(
    parseConsent(
      encodeURIComponent(
        JSON.stringify({
          version: 1,
          necessary: false,
          analytics: true,
          marketing: true,
        }),
      ),
    ),
    null,
  );
  assert.deepEqual(
    parseConsent(
      encodeURIComponent(
        JSON.stringify({
          version: 1,
          necessary: true,
          analytics: false,
          marketing: true,
        }),
      ),
    ),
    { version: 1, necessary: true, analytics: false, marketing: true },
  );
});
test("only known merchant aliases resolve to curated portals", () => {
  assert.equal(resolveInvoiceProvider(" OXXO ")?.id, "oxxo");
  assert.equal(resolveInvoiceProvider("oxxo.evil.test"), undefined);
  assert.deepEqual(resolveInvoiceProvider("OXXO")?.validate({ total: "10" }), [
    "Fecha de venta",
    "Folio de venta",
    "ID de venta",
  ]);
});
test("unconfigured OCR is honest and does not fabricate extracted fields", async () => {
  const prior = process.env.OCR_API_URL;
  delete process.env.OCR_API_URL;
  try {
    const result = await getTicketOcrAdapter().analyze({
      content: png,
      mimeType: "image/png",
    });
    assert.equal(result.provider, "manual");
    assert.equal(result.confidence, null);
    assert.deepEqual(result.fields, {});
  } finally {
    if (prior) process.env.OCR_API_URL = prior;
  }
});
test("CFDI parser refuses an unstamped document or entity expansion", () => {
  assert.throws(() => parseCfdi("<Comprobante/>"));
  assert.throws(() => parseCfdi("<!DOCTYPE a><a/>"));
});
test("migration preserves legacy ownership and enforces composite tenant relationships", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      await readFile(
        "prisma/migrations/202609200001_phase1/migration.sql",
        "utf8",
      ),
    );
    await db.exec(`INSERT INTO "User" ("id","name","email","passwordHash","updatedAt") VALUES ('a','Legacy A','a@example.test','legacy-hash',NOW()),('b','Legacy B','b@example.test','legacy-hash',NOW());
 INSERT INTO "Ticket" ("id","userId","fileName","storageKey","mimeType","total","updatedAt") VALUES ('ticket-a','a','ticket.pdf','legacy-key','application/pdf',100,NOW());
 INSERT INTO "ActivityLog" ("id","action","entityType") VALUES ('orphan','LEGACY','System');`);
    await db.exec(
      await readFile(
        "prisma/migrations/202609200002_multitenant/migration.sql",
        "utf8",
      ),
    );
    const memberships = await db.query<{ role: string }>(
      'SELECT "role" FROM "Membership"',
    );
    assert.equal(memberships.rows.length, 2);
    assert(memberships.rows.every((m) => m.role === "OWNER"));
    const ticket = await db.query<{ organizationId: string }>(
      'SELECT "organizationId" FROM "Ticket"',
    );
    assert.equal(ticket.rows[0].organizationId, "legacy_a");
    const expenses = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "Expense"',
    );
    assert.equal(
      expenses.rows[0].count,
      0,
      "legacy OCR totals must not auto-create confirmed expenses",
    );
    await assert.rejects(() =>
      db.exec(
        `INSERT INTO "Expense" ("id","organizationId","ticketId","capturedById","merchant","purchaseDate","total") VALUES ('bad','legacy_b','ticket-a','b','Other','2026-09-01',100)`,
      ),
    );
    const orphan = await db.query<{ organizationId: string }>(
      'SELECT "organizationId" FROM "ActivityLog" WHERE id=\'orphan\'',
    );
    assert.equal(orphan.rows[0].organizationId, "legacy_audit_archive");
  } finally {
    await db.close();
  }
});
