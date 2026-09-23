import { apiError, assertSameOrigin, readUpload, ApiError } from "@/lib/http";
import { requireTenant, requireAdmin } from "@/lib/tenant";
import { uploadFiscalDocument } from "@/services/fiscal";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireAdmin((await requireTenant()).role);
    const form = await readUpload(request);
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ApiError(400, "Selecciona un documento.");
    return Response.json(await uploadFiscalDocument(file), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
