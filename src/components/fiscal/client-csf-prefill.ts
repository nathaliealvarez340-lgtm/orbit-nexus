import type {
  FiscalExtractionResult,
  PrivateAssetUploadResponse,
} from "@/types/fiscal-identity";

// Presentation-only helpers: the backend remains the authority for validity and TTL.
export function pendingCsfExpired(
  asset: PrivateAssetUploadResponse,
  now = Date.now(),
) {
  return (
    !asset.precreationCsfReference ||
    !asset.expiresAt ||
    !Number.isFinite(Date.parse(asset.expiresAt)) ||
    Date.parse(asset.expiresAt) <= now
  );
}

export function prefillClientValues(
  values: Record<string, string>,
  result: FiscalExtractionResult,
) {
  const next = { ...values };
  const fields: (keyof FiscalExtractionResult["fields"])[] = [
    "rfc",
    "legalName",
    "personType",
    "postalCode",
    "street",
    "exteriorNumber",
    "interiorNumber",
    "colony",
    "locality",
    "municipality",
    "state",
    "country",
  ];
  for (const key of fields) {
    const field = result.fields[key];
    if (typeof field?.value === "string" && Object.hasOwn(values, key))
      next[key] = field.value;
  }
  // Every detected regime must be explicitly chosen, even when only one was read.
  return next;
}

export function invalidatesPendingCsf(code: string | undefined) {
  return [
    "PRECREATION_CSF_EXPIRED",
    "PRECREATION_CSF_CONSUMED",
    "PRECREATION_CSF_NOT_AVAILABLE",
    "DOCUMENT_NOT_AVAILABLE",
  ].includes(code ?? "");
}
