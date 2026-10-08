import { apiError, assertSameOrigin, readJson, ApiError } from "@/lib/http";
import {
  reviewBilling,
  submitBilling,
  collectBilling,
  cancelBilling,
} from "@/services/billing/attempts";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id, action } = await params;
    if (action === "review")
      return Response.json(await reviewBilling(id), {
        headers: { "Cache-Control": "no-store" },
      });
    if (action === "submit")
      return Response.json(await submitBilling(id, await readJson(request)));
    if (action === "collect") return Response.json(await collectBilling(id));
    if (action === "cancel") return Response.json(await cancelBilling(id));
    throw new ApiError(404, "Operación no disponible.");
  } catch (error) {
    return apiError(error);
  }
}
