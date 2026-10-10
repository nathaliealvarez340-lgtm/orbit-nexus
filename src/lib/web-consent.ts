"use client";
import { useSyncExternalStore } from "react";
import {
  parseConsent,
  type Consent,
  COOKIE_POLICY_VERSION,
  CONSENT_MAX_AGE,
} from "./consent";
let blocked = false;
let previous = "",
  cached: Consent | null = null;
export function readWebConsent() {
  if (typeof document === "undefined" || blocked) return null;
  const raw =
    document.cookie
      .split("; ")
      .find((c) => c.startsWith("orbit.consent="))
      ?.slice(14) ?? "";
  const parsed = parseConsent(raw);
  if (raw !== previous || !!parsed !== !!cached) {
    previous = raw;
    cached = parsed;
  }
  return cached;
}
function subscribe(callback: () => void) {
  window.addEventListener("orbit:consent", callback);
  window.addEventListener("focus", callback);
  return () => {
    window.removeEventListener("orbit:consent", callback);
    window.removeEventListener("focus", callback);
  };
}
export function useWebConsent() {
  return useSyncExternalStore(subscribe, readWebConsent, () => null);
}
export function saveWebConsent(analytics: boolean) {
  const value: Consent = {
    version: COOKIE_POLICY_VERSION,
    necessary: true,
    analytics,
    chosenAt: new Date().toISOString(),
  };
  try {
    document.cookie = `orbit.consent=${encodeURIComponent(JSON.stringify(value))}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    blocked = false;
    blocked = readWebConsent()?.chosenAt !== value.chosenAt;
  } catch { blocked = true; }
  window.dispatchEvent(new Event("orbit:consent"));
  return readWebConsent();
}
