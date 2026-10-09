import { apiError } from "@/lib/http";
import { searchFiscalCatalog } from "@/services/fiscal-catalogs";
// GET /api/fiscal-catalogs/product-services|units?q=&limit=
// GET /api/fiscal-catalogs/fiscal-regimes?q=&personType=
// GET /api/fiscal-catalogs/cfdi-uses?q=&personType=&regime=
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
        { personType: p.get("personType"), regime: p.get("regime") },
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
