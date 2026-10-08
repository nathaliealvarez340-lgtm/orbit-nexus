import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import QRCode from "qrcode";
import sharp from "sharp";
import {
  normalizeAmount,
  normalizeDate,
  normalizeExtraction,
} from "../src/services/ocr/normalize";
import { readTicketQr } from "../src/services/ocr/qr";
import { normalizeBillingUrl } from "../src/lib/billing-url";
import { expenseSchema } from "../src/lib/validation";
const noQr = { payload: null, warnings: [] };

test("ticket amounts preserve exact decimals, zero and null; never compute a missing total", () => {
  for (const value of ["1,234.50", "1.234,50", "$1234.50"])
    assert.equal(normalizeAmount(value), "1234.50");
  for (const value of [
    null,
    123.45,
    "-1",
    "1.234",
    "2e5",
    "10000000000",
    "NaN",
  ])
    assert.equal(normalizeAmount(value), null);
  assert.equal(normalizeAmount("0"), "0.00");
  const result = normalizeExtraction(
    { provider: "fixture", fields: { subtotal: "10", tax: "1.60" } },
    noQr,
  );
  assert.equal(result.detectedData.total, null);
  assert.equal(result.detectedData.merchantName, null);
  assert.equal(result.confidence, null);
  assert.equal(result.detectedData.currency, null);
  assert(result.warnings.includes("MISSING_TOTAL"));
  assert(
    expenseSchema.safeParse({
      merchant: "Fixture",
      purchaseDate: "2026-09-01",
      total: "0",
      subtotal: "0",
    }).success,
  );
});
test("ambiguous dates retain raw value and timezone stays unknown", () => {
  assert.equal(normalizeDate("03/04/2026"), null);
  assert.equal(normalizeDate("30/09/2026"), "2026-09-30");
  assert.equal(normalizeDate("2026-02-30"), null);
  const result = normalizeExtraction(
    { provider: "fixture", fields: { date: "03/04/2026" } },
    noQr,
  );
  assert.equal(result.detectedData.dateRaw, "03/04/2026");
  assert.equal(result.detectedData.date, null);
  assert.equal(result.detectedData.timezone, null);
  assert(result.warnings.includes("AMBIGUOUS_DATE"));
});
test("structured and labelled text are normalized, URLs are candidates and confidence is provider-only", () => {
  const result = normalizeExtraction(
    {
      provider: "fixture",
      fields: { merchantName: "Real label", ticketNumber: "TC1" },
      confidence: 0.5,
      fieldConfidence: { total: 0.6 },
      rawText:
        "RFC: AAA010101AAA\nFecha: 2026-09-28\nTotal: 1,234.50\nMoneda: MXN\nfactura.example.com",
    },
    noQr,
  );
  assert.equal(result.detectedData.total, "1234.50");
  assert.equal(result.detectedData.merchantRfc, "AAA010101AAA");
  assert.equal(result.detectedData.billingUrl, "https://factura.example.com/");
  assert.equal(result.detectedData.date, "2026-09-28");
  assert.equal(result.fieldConfidence.total, 0.6);
  assert(result.warnings.includes("LOW_CONFIDENCE"));
  const ambiguous = normalizeExtraction(
    {
      provider: "fixture",
      fields: { total: "30" },
      rawText: "Total: 10\nTotal: 20\nFecha: 2026-09-10\nFecha: 2026-09-11",
    },
    noQr,
  );
  assert.equal(ambiguous.detectedData.total, null);
  assert.equal(ambiguous.detectedData.date, null);
  assert(ambiguous.warnings.includes("MULTIPLE_TOTALS"));
  assert(ambiguous.warnings.includes("MULTIPLE_DATES"));
});
test("billing URLs accept public HTTP(S), reject dangerous/manual values without navigating", () => {
  assert.equal(
    normalizeBillingUrl(" www.example.mx/factura "),
    "https://www.example.mx/factura",
  );
  assert.equal(
    normalizeBillingUrl("http://example.com/legacy"),
    "http://example.com/legacy",
  );
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "file:///etc/hosts",
    "https://user:pass@example.com",
    "http://127.0.0.1",
    "http://[::1]",
    "http://localhost",
    "https://example.local",
    "http://2130706433",
    "https://example.com\\@evil.com",
    "https://example.com/%0a",
    "https://example.com/" + "x".repeat(1000),
  ]) {
    assert.equal(normalizeBillingUrl(value), null, value.split(":")[0]);
    assert.equal(
      expenseSchema.safeParse({
        merchant: "Fixture",
        purchaseDate: "2026-09-01",
        total: "20",
        billingUrl: value,
      }).success,
      false,
    );
  }
  const result = normalizeExtraction(
    { provider: "fixture", fields: { billingUrl: "javascript:alert(1)" } },
    noQr,
  );
  assert.equal(result.detectedData.billingUrl, null);
  assert(result.warnings.includes("SUSPICIOUS_URL"));
});
test("real QR pixels decode in PNG/JPEG/WEBP; non-URL payload never executes and PDF limitation is explicit", async () => {
  const url = "https://billing.example.com/factura?t=123";
  const png = await QRCode.toBuffer(url, { width: 500, margin: 3 });
  for (const [content, mimeType] of [
    [png, "image/png"],
    [await sharp(png).jpeg().toBuffer(), "image/jpeg"],
    [await sharp(png).webp().toBuffer(), "image/webp"],
  ] as const) {
    const qr = await readTicketQr({ content, mimeType });
    assert.equal(qr.payload, url);
    const result = normalizeExtraction({ provider: "manual", fields: {} }, qr);
    assert.equal(result.detectedData.billingUrl, url);
    assert.equal(result.detectedData.total, null);
  }
  const result = normalizeExtraction(
    { provider: "manual", fields: {} },
    { payload: "javascript:alert(1)", warnings: [] },
  );
  assert.equal(result.detectedData.qrPayload, "javascript:alert(1)");
  assert.equal(result.detectedData.billingUrl, null);
  assert(
    (
      await readTicketQr({
        content: new Uint8Array(),
        mimeType: "application/pdf",
      })
    ).warnings.includes("PDF_QR_PROVIDER_REQUIRED"),
  );
});
test("phase 4A migration preserves existing extraction rows and enforces tenant-aware audit links", async () => {
  const db = await PGlite.create();
  try {
    for (const dir of (await readdir("prisma/migrations"))
      .filter((d) => /^\d/.test(d) && d < "202609300001_ticket_intelligence")
      .sort())
      await db.exec(
        await readFile(`prisma/migrations/${dir}/migration.sql`, "utf8"),
      );
    await db.exec(`INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('u','Fixture','phase4@example.test',NOW());
      INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('a','A',NOW()),('b','B',NOW());
      INSERT INTO "Ticket" (id,"organizationId","userId","fileName","storageKey","mimeType","updatedAt") VALUES ('t','a','u','t.png','private','image/png',NOW());
      INSERT INTO "TicketExtractedData" (id,"organizationId","ticketId",provider,fields,"rawResult") VALUES ('x','a','t','legacy','{"total":"20"}','{"original":true}');`);
    await db.exec(
      await readFile(
        "prisma/migrations/202609300001_ticket_intelligence/migration.sql",
        "utf8",
      ),
    );
    const old = (
      await db.query<{ fields: unknown; rawResult: unknown }>(
        'SELECT fields,"rawResult" FROM "TicketExtractedData"',
      )
    ).rows[0];
    assert.deepEqual(old.fields, { total: "20" });
    assert.deepEqual(old.rawResult, { original: true });
    await assert.rejects(() =>
      db.exec(
        `INSERT INTO "TicketOcrAttempt" (id,"organizationId","ticketId") VALUES ('foreign','b','t')`,
      ),
    );
    await db.exec(
      `INSERT INTO "TicketOcrAttempt" (id,"organizationId","ticketId") VALUES ('owned','a','t')`,
    );
  } finally {
    await db.close();
  }
});
