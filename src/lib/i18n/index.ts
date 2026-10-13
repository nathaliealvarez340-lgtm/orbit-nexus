import { isLocale, type Locale } from "@/lib/experience/catalog";
import { common } from "./messages/common";
import { auth } from "./messages/auth";
import { onboarding } from "./messages/onboarding";
import { navigation } from "./messages/navigation";
import { settings } from "./messages/settings";
import { errors } from "./messages/errors";
export const messages = {
  common,
  auth,
  onboarding,
  navigation,
  settings,
  errors,
};
export type Namespace = keyof typeof messages;
export function translate<N extends Namespace>(
  locale: Locale,
  namespace: N,
  key: keyof (typeof messages)[N]["es-MX"],
  params: Record<string, string | number> = {},
): string {
  const dictionary = messages[namespace][
    isLocale(locale) ? locale : "es-MX"
  ] as Record<string, string>;
  const fallback = messages[namespace]["es-MX"] as Record<string, string>;
  const value = dictionary[String(key)] ?? fallback[String(key)] ?? String(key);
  return value.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
export function formatDate(value: Date, locale: Locale, timezone: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: timezone,
  }).format(value);
}
// No locale inference, exchange or persisted-money arithmetic.
export function formatMoney(
  value: number | string,
  locale: Locale,
  currency: string,
) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    Number(value),
  );
}
