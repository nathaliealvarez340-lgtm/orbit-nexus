import type { CatalogOption } from "@/types/invoice-studio";

export const catalogSearchLimit = { default: 20, max: 50 } as const;
export type SearchableCatalogEntry = CatalogOption & { keywords?: string };

// Contract §13: the source can be replaced (official SAT import) without changing
// the frontend contract. `complete` must stay false for curated subsets.
export type FiscalCatalogSource = {
  source: "CURATED_SUBSET" | "SAT_OFFICIAL";
  complete: boolean;
  search(query: string, limit?: number): CatalogOption[];
  has(code: string): boolean;
};

export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function clampSearchLimit(limit: unknown) {
  const n = Math.floor(Number(limit));
  return Number.isFinite(n) && n > 0
    ? Math.min(catalogSearchLimit.max, n)
    : catalogSearchLimit.default;
}

// Ranks exact code, then code prefix, then labels/keywords containing every term.
export function searchCatalog(
  entries: readonly SearchableCatalogEntry[],
  query: string,
  limit?: number,
): CatalogOption[] {
  const q = normalizeSearch(query.slice(0, 100)),
    terms = q.split(/\s+/).filter(Boolean);
  return entries
    .map((entry) => {
      const code = entry.code.toLowerCase();
      if (!q) return { entry, rank: 3 };
      if (code === q) return { entry, rank: 0 };
      if (code.startsWith(q)) return { entry, rank: 1 };
      const text = normalizeSearch(entry.label + " " + (entry.keywords ?? ""));
      return { entry, rank: terms.every((t) => text.includes(t)) ? 2 : -1 };
    })
    .filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, clampSearchLimit(limit))
    .map(({ entry }) => ({
      code: entry.code,
      label: entry.label,
      active: entry.active,
    }));
}

export function curatedCatalogSource(
  entries: readonly SearchableCatalogEntry[],
): FiscalCatalogSource {
  const known = new Set(entries.map((e) => e.code));
  return {
    source: "CURATED_SUBSET",
    complete: false,
    search: (query, limit) => searchCatalog(entries, query, limit),
    has: (code) => known.has(code),
  };
}
