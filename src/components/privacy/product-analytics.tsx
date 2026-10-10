"use client";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/react";
import { usePathname } from "next/navigation";
import { analyticsPath, sanitizeAnalytics } from "@/lib/analytics-policy";
import { readWebConsent, useWebConsent } from "@/lib/web-consent";
function beforeSend(event: BeforeSendEvent) {
  return sanitizeAnalytics(
    event,
    readWebConsent()?.analytics === true,
    location.origin,
  );
}
export function ProductAnalytics() {
  const consent = useWebConsent(),
    path = analyticsPath(usePathname());
  // Explicit route disables SDK automatic tracking. Only safe paths are supplied.
  // beforeSend reads the cookie at send time even after unmount/revocation.
  return consent?.analytics && path ? (
    <Analytics
      framework="next"
      mode="production"
      debug={false}
      beforeSend={beforeSend}
      route={path}
      path={path}
    />
  ) : null;
}
