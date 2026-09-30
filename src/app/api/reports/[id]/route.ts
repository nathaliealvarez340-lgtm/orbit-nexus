import { apiError, ApiError } from "@/lib/http";
import { reportSnapshot } from "@/services/reports";
import { reportPdf, reportXlsx } from "@/lib/report-exports";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const report = await reportSnapshot((await params).id),
      format = new URL(request.url).searchParams.get("format");
    if (format !== "pdf" && format !== "xlsx")
      throw new ApiError(400, "Selecciona PDF o Excel.");
    const body =
      format === "pdf"
        ? await reportPdf(report.snapshot)
        : await reportXlsx(report.snapshot);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type":
          format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="gastos-' +
          report.year +
          "-" +
          report.month +
          "." +
          format +
          '"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
