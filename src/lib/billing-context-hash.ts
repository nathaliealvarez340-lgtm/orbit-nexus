import { createHash } from "node:crypto";
/** PostgreSQL JSONB does not preserve object-key order; array/field order remains meaningful. */
export function billingContextHash(value: unknown) {
  const canonical = JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
  return createHash("sha256").update(canonical).digest("hex");
}
