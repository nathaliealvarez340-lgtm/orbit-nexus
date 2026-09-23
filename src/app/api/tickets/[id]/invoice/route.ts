import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { prepareInvoice, updateBillingDetails } from "@/services/tickets";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    return Response.json(
      await updateBillingDetails((await params).id, await readJson(request)),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    return Response.json(await prepareInvoice((await params).id));
  } catch (e) {
    return apiError(e);
  }
}
