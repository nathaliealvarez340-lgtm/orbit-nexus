import { apiError } from "@/lib/http";
import { getTicket } from "@/services/tickets";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ticket = await getTicket((await params).id);
    const { extractedData, ...safe } = ticket;
    return Response.json({
      ...safe,
      extractedData: extractedData
        ? {
            provider: extractedData.provider,
            confidence: extractedData.confidence,
            fields: extractedData.fields,
          }
        : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
