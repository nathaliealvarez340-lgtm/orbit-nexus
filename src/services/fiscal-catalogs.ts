import "server-only";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { requireTenant } from "@/lib/tenant";
import {
  isLargeCatalogKey,
  largeCatalogSources,
} from "@/lib/sat-catalogs-large";
import {
  cfdiUseCatalog,
  cfdiUseRules,
  fiscalRegimeCatalog,
  identityCatalogSource,
  regimePersonTypes,
} from "@/lib/sat-catalogs";
import { searchCatalog } from "@/lib/fiscal-catalog-search";
import type { FiscalCatalogSearchResponse } from "@/types/invoice-studio";
import type { FiscalCatalogVersioned } from "@/types/fiscal-identity";
import { requireInvoicePlan } from "./plans";

export type IdentityCatalogFilters = {
  personType?: string | null;
  regime?: string | null;
};
const identityCatalogs = ["fiscal-regimes", "cfdi-uses"] as const;
const isIdentityCatalog = (
  value: string,
): value is (typeof identityCatalogs)[number] =>
  (identityCatalogs as readonly string[]).includes(value);

// Contract §7 / §10: official régimen and Uso CFDI catalogs for Perfil Fiscal and
// Clientes. They need a session (not the invoice plan); compatibility is filtered here
// so the frontend never keeps its own copy of the rules.
function identityCatalog(
  catalog: (typeof identityCatalogs)[number],
  query: string,
  filters: IdentityCatalogFilters,
): FiscalCatalogVersioned {
  const personType =
    filters.personType === "INDIVIDUAL" || filters.personType === "COMPANY"
      ? filters.personType
      : null;
  const regime = filters.regime?.trim() || null;
  const entries =
    catalog === "fiscal-regimes"
      ? fiscalRegimeCatalog.filter(
          (option) =>
            !personType ||
            (
              regimePersonTypes.get(option.code) as string[] | undefined
            )?.includes(personType),
        )
      : cfdiUseCatalog.filter((option) => {
          const rule = cfdiUseRules.get(option.code);
          return (
            !!rule &&
            (!personType ||
              (rule.personTypes as string[]).includes(personType)) &&
            (!regime || rule.receiverRegimes.includes(regime))
          );
        });
  const complete =
    catalog === "fiscal-regimes"
      ? identityCatalogSource.regimesComplete
      : identityCatalogSource.cfdiUsesComplete;
  return {
    catalog,
    source: complete ? "SAT_OFFICIAL" : "CURATED_SUBSET",
    complete,
    version: identityCatalogSource.release,
    obtainedAt: identityCatalogSource.obtainedAt,
    results: searchCatalog(entries, query, entries.length || 1),
  };
}

// Contract §13: authenticated, rate-limited, bounded search over large SAT catalogs.
export async function searchFiscalCatalog(
  catalog: string,
  query: string,
  limit?: unknown,
  filters: IdentityCatalogFilters = {},
): Promise<FiscalCatalogSearchResponse | FiscalCatalogVersioned> {
  if (isIdentityCatalog(catalog)) {
    const { userId } = await requireTenant();
    await enforceRateLimit("fiscal-catalog:" + userId, 120, 60);
    return identityCatalog(catalog, query.slice(0, 100), filters);
  }
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
