import { apiError, assertSameOrigin } from "@/lib/http";
import { analyzeTicket } from "@/services/tickets";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    return Response.json(await analyzeTicket((await params).id));
  } catch (e) {
    return apiError(e);
  }
}
