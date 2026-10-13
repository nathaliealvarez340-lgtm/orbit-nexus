import {
  isLocale,
  THEMES,
  JOB_ROLES,
  COMMUNICATION_CATEGORIES,
  type PreferencesDto,
} from "@/lib/experience/catalog";
import type { PreferencesUpdate } from "@/lib/experience/validation";
export class PreferencesUiError extends Error {
  constructor(
    public code: string,
    public fields: string[] = [],
  ) {
    super(code);
  }
}
async function request(init?: RequestInit): Promise<PreferencesDto> {
  const response = await fetch("/api/user/preferences", {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new PreferencesUiError(
      response.status === 401
        ? "session"
        : [
              "PREFERENCES_INVALID",
              "PREFERENCES_CONFLICT",
              "COMMUNICATIONS_UNAVAILABLE",
            ].includes(data?.code)
          ? data.code
          : "unavailable",
      data?.fields
        ? Object.keys(data.fields).filter((key) =>
            ["theme", "locale", "timezone", "jobRole", "accent"].includes(key),
          )
        : [],
    );
  if (
    !data ||
    !THEMES.includes(data.theme) ||
    !isLocale(data.locale) ||
    typeof data.timezone !== "string" ||
    !Number.isInteger(data.revision) ||
    data.revision < 0 ||
    !["PURPLE", "BLUE", "ORANGE", "RED"].includes(data.accent) ||
    (data.jobRole !== null && !JOB_ROLES.includes(data.jobRole)) ||
    typeof data.onboardingCompleted !== "boolean" ||
    typeof data.communicationsAvailable !== "boolean" ||
    COMMUNICATION_CATEGORIES.some(
      (category) => typeof data.communications?.[category] !== "boolean",
    )
  )
    throw new PreferencesUiError("unavailable");
  return {
    theme: data.theme,
    locale: data.locale,
    timezone: data.timezone,
    accent: data.accent,
    revision: data.revision,
    jobRole: data.jobRole,
    onboardingCompleted: data.onboardingCompleted,
    communicationsAvailable: data.communicationsAvailable,
    communications: Object.fromEntries(
      COMMUNICATION_CATEGORIES.map((key) => [key, data.communications[key]]),
    ) as PreferencesDto["communications"],
  };
}
export const loadPreferences = () => request();
export const savePreferences = (body: PreferencesUpdate) =>
  request({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
