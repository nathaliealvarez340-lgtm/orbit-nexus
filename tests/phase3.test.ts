import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { invoiceTotals } from "../src/lib/invoice-totals";
import { closedPeriods, type ReportSnapshot } from "../src/lib/report-periods";
import { reportPdf, reportXlsx } from "../src/lib/report-exports";
import { cfdiUseSchema, draftSchema } from "../src/lib/phase3-validation";
import { fiscalProfileComplete } from "../src/lib/fiscal-catalogs";

test("invoice amounts use decimal arithmetic and round tax once per line", () => {
  const totals = invoiceTotals([
    { quantity: "2.5", unitPrice: "12.34", taxRate: "0.16" },
    { quantity: "3", unitPrice: "0.10", taxRate: "0.16" },
  ]);
  assert.equal(totals.subtotal.toFixed(2), "31.15");
  assert.equal(totals.tax.toFixed(2), "4.99");
  assert.equal(totals.total.toFixed(2), "36.14");
});
test("closed periods respect Mexico midnight, leap year and year rollover", () => {
  assert.deepEqual(
    closedPeriods(
      new Date("2025-12-01T12:00:00Z"),
      new Date("2026-01-01T05:59:59Z"),
    ),
    [],
  );
  assert.deepEqual(
    closedPeriods(
      new Date("2025-12-01T12:00:00Z"),
      new Date("2026-01-01T06:00:00Z"),
    ),
    [{ year: 2025, month: 12 }],
  );
  assert.deepEqual(
    closedPeriods(
      new Date("2024-02-29T12:00:00Z"),
      new Date("2024-03-01T06:00:00Z"),
    ),
    [{ year: 2024, month: 2 }],
  );
});
test("fiscal completeness requires CSF and address; catalogs refuse arbitrary use codes", () => {
  const address = {
    street: "Calle",
    exteriorNumber: "1",
    colony: "Centro",
    locality: "Ciudad",
    municipality: "Municipio",
    state: "Estado",
    country: "MEX",
  };
  assert.equal(fiscalProfileComplete(address), false);
  assert.equal(
    fiscalProfileComplete({ ...address, csfDocumentId: "synthetic" }),
    true,
  );
  assert.equal(cfdiUseSchema.safeParse("CP01").success, true);
  assert.equal(cfdiUseSchema.safeParse("Z99").success, false);
  assert.equal(draftSchema.safeParse({}).success, false);
});
test("exports are parseable PDF and XLSX, preserve numeric totals and never create Excel formulas", async () => {
  const snapshot: ReportSnapshot = {
    organization: "Empresa de prueba Ñ",
    rfc: "AAA010101AAA",
    year: 2026,
    month: 8,
    total: "123.45",
    ticketCount: 1,
    invoiceCount: 0,
    pendingCount: 1,
    rows: [
      {
        date: "2026-08-01",
        merchant: "=SUM(A1:A2)",
        rfc: "AAA010101AAA",
        folio: "Prueba",
        uuid: "",
        total: "123.45",
        status: "NOT_REQUESTED",
      },
    ],
  };
  const pdf = await PDFDocument.load(
    await reportPdf({
      ...snapshot,
      rows: Array.from({ length: 80 }, () => snapshot.rows[0]),
    }),
  );
  assert(pdf.getPageCount() > 1);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await reportXlsx(snapshot)).buffer);
  assert.deepEqual(
    book.worksheets.map((s) => s.name),
    ["Resumen", "Detalle"],
  );
  assert.equal(book.getWorksheet("Resumen")!.getCell("B5").value, 123.45);
  assert.equal(
    book.getWorksheet("Detalle")!.getCell("B2").value,
    "=SUM(A1:A2)",
  );
  assert.equal(
    book.getWorksheet("Detalle")!.getCell("B2").type,
    ExcelJS.ValueType.String,
  );
});
test("phase 3 migration preserves existing rows and rejects cross-tenant client/document links", async () => {
  const db = await PGlite.create();
  try {
    for (const name of ["202609200001_phase1", "202609200002_multitenant"])
      await db.exec(
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
    await db.exec(`INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('u','Existing','existing@example.test',NOW());
      INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('a','A',NOW()),('b','B',NOW());
      INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,"updatedAt") VALUES ('fp','u','a','AAA010101AAA','Existing legal name','601','06000','G03','fiscal@example.test',NOW());
      INSERT INTO "StampedInvoice" (id,"organizationId","userId","issuerRfc","receiverRfc",subtotal,tax,total,"updatedAt") VALUES ('legacy','a','u','AAA010101AAA','BBB010101BBB',100,16,116,NOW());`);
    const migration = await readFile(
      "prisma/migrations/202609270001_phase3/migration.sql",
      "utf8",
    );
    assert(
      !/\b(DROP|TRUNCATE|DELETE)\s+(TABLE|COLUMN|FROM)\b/i.test(migration),
    );
    await db.exec(migration);
    assert.equal(
      (
        await db.query<{ total: string }>(
          "SELECT total::text FROM \"StampedInvoice\" WHERE id='legacy'",
        )
      ).rows[0].total,
      "116.00",
    );
    assert.equal(
      (
        await db.query<{ legalName: string }>(
          'SELECT "legalName" FROM "FiscalProfile"',
        )
      ).rows[0].legalName,
      "Existing legal name",
    );
    await db.exec(`INSERT INTO "Client" (id,"organizationId",rfc,"legalName","fiscalRegime","cfdiUse",email,"postalCode","updatedAt") VALUES ('client-b','b','BBB010101BBB','B','601','G03','b@example.test','06000',NOW());
      INSERT INTO "Document" (id,"organizationId","uploadedById","fileName","mimeType",size,sha256,content,kind) VALUES ('doc-b','b','u','synthetic.pdf','application/pdf',0,'synthetic',''::bytea,'CSF');`);
    await assert.rejects(
      db.exec(
        `UPDATE "StampedInvoice" SET "clientId"='client-b' WHERE id='legacy'`,
      ),
    );
    await assert.rejects(
      db.exec(
        `UPDATE "FiscalProfile" SET "csfDocumentId"='doc-b' WHERE id='fp'`,
      ),
    );
  } finally {
    await db.close();
  }
});
