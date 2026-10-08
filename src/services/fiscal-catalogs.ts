import "server-only";
import { ApiError, enforceRateLimit } from "@/lib/http";
import {
  isLargeCatalogKey,
  largeCatalogSources,
} from "@/lib/sat-catalogs-large";
import type { FiscalCatalogSearchResponse } from "@/types/invoice-studio";
import { requireInvoicePlan } from "./plans";

// Contract §13: authenticated, rate-limited, bounded search over large SAT catalogs.
export async function searchFiscalCatalog(
  catalog: string,
  query: string,
  limit?: unknown,
): Promise<FiscalCatalogSearchResponse> {
  const { userId } = await requireInvoicePlan();
  await enforceRateLimit("fiscal-catalog:" + userId, 120, 60);
  if (!isLargeCatalogKey(catalog))
    throw new ApiError(404, "Catálogo no disponible.");
  const source = largeCatalogSources[catalog];
  return {
    catalog,
    source: source.source,
    complete: source.complete,
    results: source.search(query.slice(0, 100), Number(limit)),
  };
}
