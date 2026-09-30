import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { Prisma } from "@/generated/prisma/client";
export async function dashboardData(year: number, currency = "MXN") {
  const { organizationId } = await requireTenant();
  const db = getDb();
  const start = new Date(Date.UTC(year, 0, 1)),
    end = new Date(Date.UTC(year + 1, 0, 1));
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const currentYear = Number(today.find((p) => p.type === "year")!.value),
    month = Number(today.find((p) => p.type === "month")!.value) - 1;
  const [
    monthly,
    ticketCount,
    pending,
    invoiced,
    invoiceCount,
    activity,
    recent,
    monthTotal,
  ] = await Promise.all([
    db.$queryRaw<
      Array<{ month: number; total: PrismaDecimal }>
    >`SELECT EXTRACT(MONTH FROM "purchaseDate")::int AS month, SUM("total") AS total FROM "Expense" WHERE "organizationId" = ${organizationId} AND "purchaseDate" >= ${start} AND "purchaseDate" < ${end} GROUP BY 1 ORDER BY 1`,
    db.ticket.count({ where: { organizationId } }),
    db.ticket.count({
      where: { organizationId, billingStatus: { not: "INVOICED" } },
    }),
    db.ticket.count({ where: { organizationId, billingStatus: "INVOICED" } }),
    db.invoice.count({ where: { organizationId, status: "ISSUED" } }),
    db.activityLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, createdAt: true },
    }),
    db.ticket.findMany({
      where: { organizationId },
      include: { expense: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    db.expense.aggregate({
      where: {
        organizationId,
        purchaseDate: {
          gte: new Date(Date.UTC(currentYear, month, 1)),
          lt: new Date(Date.UTC(currentYear, month + 1, 1)),
        },
      },
      _sum: { total: true },
    }),
  ]);
  const months = [
    "ENE",
    "FEB",
    "MAR",
    "ABR",
    "MAY",
    "JUN",
    "JUL",
    "AGO",
    "SEP",
    "OCT",
    "NOV",
    "DIC",
  ];
  const bars = months.map((month, i) => ({
    month,
    total: Number(monthly.find((m) => m.month === i + 1)?.total ?? 0),
  }));
  // issuedAt is stored in UTC; bucket by the organization's Mexican business calendar.
  const [issued, currentIssued] = await Promise.all([
    db.$queryRaw<
      Array<{ month: number; total: PrismaDecimal; count: number }>
    >`SELECT EXTRACT(MONTH FROM ("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City'))::int AS month, SUM(total) AS total, COUNT(*)::int AS count FROM "StampedInvoice" WHERE "organizationId"=${organizationId} AND status='ISSUED' AND uuid IS NOT NULL AND "documentType"='I' AND currency=${currency} AND ("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') >= ${start} AND ("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') < ${end} GROUP BY 1`,
    db.$queryRaw<
      Array<{ total: PrismaDecimal | null }>
    >`SELECT SUM(total) AS total FROM "StampedInvoice" WHERE "organizationId"=${organizationId} AND status='ISSUED' AND uuid IS NOT NULL AND "documentType"='I' AND currency=${currency} AND ("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') >= ${new Date(Date.UTC(currentYear, month, 1))} AND ("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') < ${new Date(Date.UTC(currentYear, month + 1, 1))}`,
  ]);
  const issuedBars = months.map((month, i) => ({
    month,
    total: Number(issued.find((item) => item.month === i + 1)?.total ?? 0),
  }));
  const sum = (rows: { total: PrismaDecimal }[]) =>
    Number(
      rows.reduce(
        (total, item) => total.add(item.total.toString()),
        new Prisma.Decimal(0),
      ),
    );
  return {
    issuedBars,
    issuedYearTotal: sum(issued),
    issuedMonthTotal: Number(currentIssued[0]?.total ?? 0),
    issuedCount: issued.reduce((count, item) => count + item.count, 0),
    bars,
    yearTotal: sum(monthly),
    monthTotal: Number(monthTotal._sum.total ?? 0),
    ticketCount,
    pending,
    invoiced,
    invoiceCount,
    activity,
    recent,
  };
}
type PrismaDecimal = { toString(): string };
