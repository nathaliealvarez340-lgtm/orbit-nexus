import "server-only";
import { closedPeriods, type ReportSnapshot } from "@/lib/report-periods";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

// Monthly expense reports of one Organization. `organizationId` must come from a
// server-validated tenant (see reports.ts); every query below is scoped to it.
export type ReportTenant = { organizationId: string; organizationName: string };

export async function listMonthlyReports(
  db: PrismaClient,
  { organizationId, organizationName }: ReportTenant,
) {
  const [org, first, existing, profile] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    db.expense.findFirst({
      where: { organizationId },
      orderBy: { purchaseDate: "asc" },
      select: { purchaseDate: true },
    }),
    db.monthlyExpenseReport.findMany({
      where: { organizationId },
      select: { year: true, month: true },
    }),
    db.fiscalProfile.findUnique({ where: { organizationId } }),
  ]);
  // Date-only expense values denote calendar dates, not instants in Mexico.
  const firstDate = first
    ? new Date(first.purchaseDate.getTime() + 12 * 3600000)
    : org.createdAt;
  const since = firstDate < org.createdAt ? firstDate : org.createdAt;
  for (const { year, month } of closedPeriods(since)) {
    // Fast path only: a concurrent request can create the period after this read.
    if (existing.some((r) => r.year === year && r.month === month)) continue;
    await ensureMonthlyReport(db, {
      organizationId,
      organizationName,
      rfc: profile?.rfc ?? "Sin perfil fiscal",
      year,
      month,
    });
  }
  const reports = await db.monthlyExpenseReport.findMany({
    where: { organizationId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: {
      id: true,
      year: true,
      month: true,
      total: true,
      ticketCount: true,
      invoiceCount: true,
      pendingCount: true,
      createdAt: true,
      snapshot: true,
    },
  });
  const invoices = await db.invoice.findMany({
    where: {
      organizationId,
      status: "ISSUED",
      ticketId: {
        in: reports.flatMap((r) =>
          (r.snapshot as unknown as ReportSnapshot).rows.flatMap((row) =>
            row.ticketId ? [row.ticketId] : [],
          ),
        ),
      },
    },
    select: { ticketId: true, uuid: true },
  });
  return reports.map(({ snapshot: raw, ...report }) => {
    const snapshot = enrichInvoiceEvidence(
      raw as unknown as ReportSnapshot,
      invoices,
    );
    return {
      ...report,
      invoiceCount: snapshot.invoiceCount,
      pendingCount: snapshot.pendingCount,
    };
  });
}

// Closes one month at most once per Organization, also under concurrent requests.
// The unique key (organizationId, year, month) is the authority: Prisma's upsert with an
// empty update runs SELECT then INSERT, so two requests could both miss the row and the
// second failed with a unique violation (P2002). INSERT ... ON CONFLICT DO NOTHING
// (createMany + skipDuplicates) waits for a concurrent insert of the same period and keeps
// that report and snapshot; the report is then read back and its notification is created
// the same way, so each period has one report, one snapshot and one notification.
async function ensureMonthlyReport(
  db: PrismaClient,
  input: ReportTenant & { rfc: string; year: number; month: number },
) {
  const { organizationId, year, month } = input;
  await db.$transaction(
    async (tx) => {
      const expenses = await tx.expense.findMany({
        where: {
          organizationId,
          purchaseDate: {
            gte: new Date(Date.UTC(year, month - 1, 1)),
            lt: new Date(Date.UTC(year, month, 1)),
          },
        },
        include: { ticket: { include: { invoice: true } } },
        orderBy: [{ purchaseDate: "asc" }, { id: "asc" }],
      });
      const total = expenses.reduce(
        (sum, e) => sum.add(e.total),
        new Prisma.Decimal(0),
      );
      const invoiceCount = expenses.filter(
        (e) => e.ticket.invoice?.status === "ISSUED",
      ).length;
      const snapshot: ReportSnapshot = {
        organization: input.organizationName,
        rfc: input.rfc,
        year,
        month,
        total: total.toFixed(2),
        ticketCount: expenses.length,
        invoiceCount,
        pendingCount: expenses.length - invoiceCount,
        rows: expenses.map((e) => ({
          ticketId: e.ticketId,
          date: e.purchaseDate.toISOString().slice(0, 10),
          merchant: e.merchant,
          rfc: String(
            (e.details as Record<string, unknown> | null)?.issuerRfc ?? "",
          ),
          folio: e.folio ?? "",
          uuid: e.ticket.invoice?.uuid ?? "",
          total: e.total.toFixed(2),
          status: e.billingStatus,
        })),
      };
      await tx.monthlyExpenseReport.createMany({
        data: [
          {
            organizationId,
            year,
            month,
            total,
            ticketCount: snapshot.ticketCount,
            invoiceCount,
            pendingCount: snapshot.pendingCount,
            snapshot,
          },
        ],
        skipDuplicates: true,
      });
      const report = await tx.monthlyExpenseReport.findUniqueOrThrow({
        where: { organizationId_year_month: { organizationId, year, month } },
        select: { id: true },
      });
      await tx.notification.createMany({
        data: [
          {
            organizationId,
            eventKey: "report:" + report.id,
            title: "Reporte mensual disponible",
            message: `${String(month).padStart(2, "0")}/${year} · Gastos confirmados`,
            href: "/dashboard/reports",
            type: "REPORT_AVAILABLE",
          },
        ],
        skipDuplicates: true,
      });
    },
    // READ COMMITTED (PostgreSQL's default, made explicit): the read after ON CONFLICT
    // DO NOTHING must see the report committed by the concurrent request.
    {
      timeout: 20000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}

export function enrichInvoiceEvidence(
  original: ReportSnapshot,
  invoices: { ticketId: string | null; uuid: string | null }[],
) {
  const rows = original.rows.map((row) => {
    const invoice = row.ticketId
      ? invoices.find((i) => i.ticketId === row.ticketId)
      : undefined;
    return invoice
      ? { ...row, uuid: invoice.uuid ?? "", status: "INVOICED" }
      : row;
  });
  const invoiceCount = rows.filter((r) => r.status === "INVOICED").length;
  return {
    ...original,
    rows,
    invoiceCount,
    pendingCount: original.ticketCount - invoiceCount,
  };
}
