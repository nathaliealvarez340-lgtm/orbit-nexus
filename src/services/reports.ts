import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError } from "@/lib/http";
import { closedPeriods, type ReportSnapshot } from "@/lib/report-periods";
import { Prisma } from "@/generated/prisma/client";
export async function monthlyReports() {
  const { organizationId, organization } = await requireTenant(),
    db = getDb();
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
    if (existing.some((r) => r.year === year && r.month === month)) continue;
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
          organization: organization.name,
          rfc: profile?.rfc ?? "Sin perfil fiscal",
          year,
          month,
          total: total.toFixed(2),
          ticketCount: expenses.length,
          invoiceCount,
          pendingCount: expenses.length - invoiceCount,
          rows: expenses.map((e) => ({
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
        const report = await tx.monthlyExpenseReport.upsert({
          where: { organizationId_year_month: { organizationId, year, month } },
          update: {},
          create: {
            organizationId,
            year,
            month,
            total,
            ticketCount: snapshot.ticketCount,
            invoiceCount,
            pendingCount: snapshot.pendingCount,
            snapshot,
          },
        });
        await tx.notification.upsert({
          where: {
            organizationId_eventKey: {
              organizationId,
              eventKey: "report:" + report.id,
            },
          },
          update: {},
          create: {
            organizationId,
            eventKey: "report:" + report.id,
            title: "Reporte mensual disponible",
            message: `${String(month).padStart(2, "0")}/${year} · Gastos confirmados`,
            href: "/dashboard/reports",
            type: "REPORT_AVAILABLE",
          },
        });
      },
      { timeout: 20000 },
    );
  }
  return db.monthlyExpenseReport.findMany({
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
    },
  });
}
export async function reportSnapshot(id: string) {
  const { organizationId } = await requireTenant();
  const report = await getDb().monthlyExpenseReport.findFirst({
    where: { organizationId, id },
  });
  if (!report) throw new ApiError(404, "Reporte no disponible.");
  return { ...report, snapshot: report.snapshot as unknown as ReportSnapshot };
}
