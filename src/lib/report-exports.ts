import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import type { ReportSnapshot } from "./report-periods";
// Standard PDF fonts cover Spanish; replace unsupported glyphs without breaking exports.
const printable = (value: string) =>
  value.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
export async function reportPdf(report: ReportSnapshot) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]),
    y = 795;
  function line(value: string, size = 10) {
    const text = printable(value);
    // Wrap by measured width to retain all detail fields and long legal names.
    let remaining = text;
    do {
      if (y < 45) {
        page = pdf.addPage([595, 842]);
        y = 795;
      }
      let length = remaining.length;
      while (
        length > 1 &&
        font.widthOfTextAtSize(remaining.slice(0, length), size) > 505
      )
        length--;
      page.drawText(remaining.slice(0, length), {
        x: 45,
        y,
        size,
        font,
        color: rgb(0.12, 0.12, 0.15),
      });
      y -= size + 7;
      remaining = remaining.slice(length);
    } while (remaining.length);
  }
  line("ORBIT NEXUS · Reporte mensual de gastos", 18);
  line(report.organization, 13);
  line("RFC: " + report.rfc);
  line(
    `Periodo: ${report.year}-${String(report.month).padStart(2, "0")} · MXN`,
  );
  line(
    `Gasto total: $${report.total} · Tickets registrados: ${report.ticketCount}`,
  );
  line(
    `Facturas obtenidas: ${report.invoiceCount} · Pendientes: ${report.pendingCount}`,
  );
  line("Corte al generar el reporte. No es un comprobante fiscal.");
  y -= 10;
  for (const row of report.rows) {
    line(`${row.date} | ${row.merchant} | $${row.total} MXN`, 11);
    line(
      `RFC: ${row.rfc || "—"} · Folio: ${row.folio || "—"} · Estado: ${row.status}`,
    );
    line(`UUID: ${row.uuid || "Pendiente"}`);
    y -= 7;
  }
  if (!report.rows.length) line("Sin gastos registrados en este mes.");
  for (const [i, p] of pdf.getPages().entries())
    p.drawText(`${i + 1} / ${pdf.getPageCount()}`, {
      x: 510,
      y: 20,
      size: 8,
      font,
    });
  return pdf.save();
}
export async function reportXlsx(report: ReportSnapshot) {
  const book = new ExcelJS.Workbook();
  book.creator = "ORBIT NEXUS";
  const summary = book.addWorksheet("Resumen");
  summary.columns = [{ width: 30 }, { width: 65 }];
  summary.addRows([
    ["Empresa", report.organization],
    ["RFC", report.rfc],
    ["Periodo", `${report.year}-${String(report.month).padStart(2, "0")}`],
    ["Moneda", "MXN"],
    ["Gasto total", Number(report.total)],
    ["Tickets registrados", report.ticketCount],
    ["Facturas obtenidas", report.invoiceCount],
    ["Pendientes", report.pendingCount],
    ["Alcance", "Corte al generar el reporte. No es un comprobante fiscal."],
  ]);
  summary.getCell("B5").numFmt = '"$"#,##0.00';
  const detail = book.addWorksheet("Detalle", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  detail.columns = [
    "Fecha",
    "Comercio",
    "RFC",
    "Folio",
    "UUID",
    "Total MXN",
    "Estado",
  ].map((header, i) => ({ header, width: [14, 40, 19, 25, 40, 18, 25][i] }));
  for (const row of report.rows)
    detail.addRow([
      row.date,
      row.merchant,
      row.rfc,
      row.folio,
      row.uuid,
      Number(row.total),
      row.status,
    ]);
  detail.getColumn(6).numFmt = '"$"#,##0.00';
  detail.autoFilter = "A1:G1";
  for (const sheet of [summary, detail]) {
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF6D28D9" },
    };
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}
