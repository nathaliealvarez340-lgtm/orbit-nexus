import "server-only";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { ApiError } from "@/lib/http";
import type { ReportSnapshot } from "@/lib/report-periods";
import { enrichInvoiceEvidence, listMonthlyReports } from "./monthly-reports";
export async function monthlyReports() {
  const { organizationId, organization } = await requireTenant();
  return listMonthlyReports(getDb(), {
    organizationId,
    organizationName: organization.name,
  });
}
export async function reportSnapshot(id: string) {
  const { organizationId } = await requireTenant();
  const report = await getDb().monthlyExpenseReport.findFirst({
    where: { organizationId, id },
  });
  if (!report) throw new ApiError(404, "Reporte no disponible.");
  const original = report.snapshot as unknown as ReportSnapshot;
  // Financial closure stays immutable. Only attach later CFDI evidence by an exact tenant/ticket link.
  const invoices = await getDb().invoice.findMany({
    where: {
      organizationId,
      status: "ISSUED",
      ticketId: {
        in: original.rows.flatMap((r) => (r.ticketId ? [r.ticketId] : [])),
      },
    },
    select: { ticketId: true, uuid: true },
  });
  const snapshot = enrichInvoiceEvidence(original, invoices);
  return { ...report, snapshot };
}
