import { ApiError, apiError, assertSameOrigin, readUpload } from "@/lib/http";
import { requireTenant } from "@/lib/tenant";
import { uploadPrivateAsset } from "@/services/private-assets";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireTenant();
    const form = await readUpload(request),
      file = form.get("file"),
      kind = form.get("kind");
    if (!(file instanceof File) || (kind !== "CSF" && kind !== "INVOICE_LOGO"))
      throw new ApiError(400, "Archivo o categoría inválidos.");
    return Response.json(await uploadPrivateAsset(file, kind), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
