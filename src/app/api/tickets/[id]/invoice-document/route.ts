import { apiError, assertSameOrigin, readUpload, ApiError } from "@/lib/http";
import { requireTenant } from "@/lib/tenant";
import { importInvoice } from "@/services/invoices";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    await requireTenant();
    // One 1 MB XML and one 10 MB PDF, plus bounded multipart headers.
    const data = await readUpload(request, 11 * 1024 * 1024 + 65536);
    const xml = data.get("xml");
    const pdf = data.get("pdf");
    if (!(xml instanceof File)) throw new ApiError(400, "Selecciona un XML.");
    return Response.json(
      await importInvoice(
        (await params).id,
        xml,
        pdf instanceof File && pdf.size ? pdf : null,
        data.get("confirmed") === "true",
      ),
      { status: 201 },
    );
  } catch (e) {
    return apiError(e);
  }
}
