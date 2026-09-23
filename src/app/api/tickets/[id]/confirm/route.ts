import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { confirmExpense } from "@/services/tickets";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    return Response.json(
      await confirmExpense((await params).id, await readJson(request)),
    );
  } catch (e) {
    return apiError(e);
  }
}
