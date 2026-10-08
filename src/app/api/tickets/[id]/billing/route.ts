import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { billingHistory, prepareBilling } from "@/services/billing/attempts";
import { billingOptions } from "@/services/billing/providers";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      { ...(await billingOptions(id)), attempts: await billingHistory(id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    return Response.json(
      await prepareBilling((await params).id, await readJson(request)),
    );
  } catch (error) {
    return apiError(error);
  }
}
