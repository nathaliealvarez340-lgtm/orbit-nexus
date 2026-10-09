import { codedApiError } from "@/lib/invoice-api";
import { getFiscalExtraction } from "@/services/fiscal-documents";
// GET /api/fiscal-extractions/[id] → FiscalExtractionResult (tenant-scoped).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(await getFiscalExtraction((await params).id));
  } catch (e) {
    return codedApiError(e);
  }
}
