import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
export async function dashboardData(year: number) {
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
  return {
    bars,
    yearTotal: bars.reduce((sum, m) => sum + m.total, 0),
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
