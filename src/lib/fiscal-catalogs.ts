import { cfdiUseCatalog, paymentFormCatalog } from "./sat-catalogs";
// [code, label] views of the shared SAT catalogs in ./sat-catalogs (Phase 3 forms).
// Catalog codes are stored, descriptions are presentation only.
export const cfdiUses = cfdiUseCatalog.map((o) => [o.code, o.label] as const);
export const paymentForms = paymentFormCatalog.map(
  (o) => [o.code, o.label] as const,
);
export const addressFields = [
  ["street", "Calle"],
  ["exteriorNumber", "Número exterior"],
  ["interiorNumber", "Número interior (opcional)"],
  ["colony", "Colonia"],
  ["locality", "Localidad"],
  ["municipality", "Municipio / alcaldía"],
  ["state", "Estado"],
  ["country", "País (código de tres letras)"],
] as const;
export function fiscalProfileComplete(
  profile: {
    csfDocumentId?: string | null;
    street?: string | null;
    exteriorNumber?: string | null;
    colony?: string | null;
    locality?: string | null;
    municipality?: string | null;
    state?: string | null;
    country?: string | null;
  } | null,
) {
  return (
    !!profile &&
    [
      profile.csfDocumentId,
      profile.street,
      profile.exteriorNumber,
      profile.colony,
      profile.locality,
      profile.municipality,
      profile.state,
      profile.country,
    ].every(Boolean)
  );
}
