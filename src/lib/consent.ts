// Web preferences only. Fiscal consents use their separate backend contract.
export const COOKIE_POLICY_VERSION = "2";
export const CONSENT_MAX_AGE = 15552000;
export type Consent = {
  version: typeof COOKIE_POLICY_VERSION;
  necessary: true;
  analytics: boolean;
  chosenAt: string;
};
export function parseConsent(value?: string): Consent | null {
  try {
    const v = JSON.parse(decodeURIComponent(value || ""));
    const chosen = Date.parse(v.chosenAt);
    return v.version === COOKIE_POLICY_VERSION &&
      v.necessary === true &&
      typeof v.analytics === "boolean" &&
      typeof v.chosenAt === "string" &&
      Number.isFinite(chosen) &&
      chosen <= Date.now() &&
      Date.now() - chosen < CONSENT_MAX_AGE * 1000
      ? {
          version: COOKIE_POLICY_VERSION,
          necessary: true,
          analytics: v.analytics,
          chosenAt: v.chosenAt,
        }
      : null;
  } catch {
    return null;
  }
}
