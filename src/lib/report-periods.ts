export function currentMexicoMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === "year")!.value),
    month: Number(parts.find((p) => p.type === "month")!.value),
  };
}
export function closedPeriods(since: Date, now = new Date()) {
  const end = currentMexicoMonth(now),
    start = currentMexicoMonth(since);
  const periods: { year: number; month: number }[] = [];
  for (
    let n = start.year * 12 + start.month - 1;
    n < end.year * 12 + end.month - 1;
    n++
  )
    periods.push({ year: Math.floor(n / 12), month: (n % 12) + 1 });
  return periods;
}
export type ReportSnapshot = {
  organization: string;
  rfc: string;
  year: number;
  month: number;
  total: string;
  ticketCount: number;
  invoiceCount: number;
  pendingCount: number;
  rows: {
    date: string;
    merchant: string;
    rfc: string;
    folio: string;
    uuid: string;
    total: string;
    status: string;
  }[];
};
