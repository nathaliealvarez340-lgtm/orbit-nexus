export type Consent = {
  version: 1;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
};
export function parseConsent(value?: string): Consent | null {
  try {
    const v = JSON.parse(decodeURIComponent(value || ""));
    return v.version === 1 &&
      v.necessary === true &&
      typeof v.analytics === "boolean" &&
      typeof v.marketing === "boolean"
      ? {
          version: 1,
          necessary: true,
          analytics: v.analytics,
          marketing: v.marketing,
        }
      : null;
  } catch {
    return null;
  }
}
