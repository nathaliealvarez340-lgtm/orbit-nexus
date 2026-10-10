import type { BeforeSendEvent } from "@vercel/analytics";
const paths = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/cookies",
  "/dashboard",
  "/dashboard/reports",
  "/dashboard/invoices/new",
]);
export function analyticsPath(pathname: string) {
  return paths.has(pathname) ? pathname : null;
}
// Construct a fresh payload: extra keys, queries, fragments and custom events
// cannot pass through. No business identifiers or custom properties are accepted.
export function sanitizeAnalytics(
  event: BeforeSendEvent,
  allowed: boolean,
  origin: string,
): BeforeSendEvent | null {
  if (!allowed || event.type !== "pageview") return null;
  try {
    const url = new URL(event.url, origin);
    const path = analyticsPath(url.pathname);
    if (url.origin !== origin || url.username || url.password || !path)
      return null;
    return { type: "pageview", url: new URL(path, origin).href };
  } catch {
    return null;
  }
}
