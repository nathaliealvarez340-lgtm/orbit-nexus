const normalized = new Set([
  "Revisa los campos indicados.",
  "No pudimos completar la operación. Intenta nuevamente.",
  "Demasiadas solicitudes. Espera un momento.",
  "Origen no permitido.",
]);
export function safeFormError(body: unknown, fallback: string) {
  const value =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return typeof value.error === "string" && normalized.has(value.error)
    ? value.error
    : fallback;
}
export function errorFields(body: unknown, allowed: readonly string[]) {
  const value =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).fields
      : null;
  return value && typeof value === "object"
    ? Object.keys(value).filter((key) => allowed.includes(key))
    : [];
}
