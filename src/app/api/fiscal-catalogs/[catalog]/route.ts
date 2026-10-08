import { apiError } from "@/lib/http";
import { searchFiscalCatalog } from "@/services/fiscal-catalogs";
// GET /api/fiscal-catalogs/product-services|units?q=&limit=
export async function GET(
  request: Request,
  { params }: { params: Promise<{ catalog: string }> },
) {
  try {
    const p = new URL(request.url).searchParams;
    return Response.json(
      await searchFiscalCatalog(
        (await params).catalog,
        p.get("q") ?? "",
        p.get("limit"),
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
