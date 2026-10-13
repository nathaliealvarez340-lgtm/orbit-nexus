export const SUPPORTED_LOCALES = ["es-MX", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_CATALOG = {
  "es-MX": { label: "Español", language: "es", direction: "ltr" },
  "en-US": { label: "English", language: "en", direction: "ltr" },
} as const;
export const THEMES = ["LIGHT", "DARK"] as const;
export type Theme = (typeof THEMES)[number];
export const JOB_ROLES = [
  "FOUNDER_CEO",
  "FINANCE_ACCOUNTING",
  "OPERATIONS",
  "PRODUCT",
  "ENGINEERING_TECH",
  "MARKETING_SALES",
  "CONSULTANT",
  "DESIGNER",
  "OTHER",
] as const;
export type JobRole = (typeof JOB_ROLES)[number];
export const COMMUNICATION_CATEGORIES = [
  "NEWS_UPDATES",
  "PRODUCT_NEWS",
  "COMMERCIAL_OFFERS",
] as const;
export type CommunicationCategory = (typeof COMMUNICATION_CATEGORIES)[number];
export type Overrides = {
  theme?: Theme | null;
  locale?: string | null;
  timezone?: string | null;
};
export const PRODUCT_DEFAULTS = {
  theme: "DARK" as Theme,
  locale: "es-MX" as Locale,
  timezone: "UTC",
};
export function isLocale(value: unknown): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => value === locale);
}
export function isTimezone(value: string) {
  // IANA names, never an offset or an arbitrary formatter string. UTC is the IANA UTC zone.
  if (value !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value))
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function resolveExperience(
  user: Overrides = {},
  organization: Overrides = {},
) {
  return {
    theme: user.theme ?? organization.theme ?? PRODUCT_DEFAULTS.theme,
    locale: isLocale(user.locale)
      ? user.locale
      : isLocale(organization.locale)
        ? organization.locale
        : PRODUCT_DEFAULTS.locale,
    timezone:
      user.timezone && isTimezone(user.timezone)
        ? user.timezone
        : organization.timezone && isTimezone(organization.timezone)
          ? organization.timezone
          : PRODUCT_DEFAULTS.timezone,
  };
}
export type PreferencesDto = ReturnType<typeof resolveExperience> & {
  accent: "PURPLE" | "BLUE" | "ORANGE" | "RED";
  jobRole: JobRole | null;
  revision: number;
  onboardingCompleted: boolean;
  communicationsAvailable: boolean;
  communications: Record<CommunicationCategory, boolean>;
};
