"use client";
import { useExperience } from "./experience-provider";
import {
  THEMES,
  SUPPORTED_LOCALES,
  LOCALE_CATALOG,
  JOB_ROLES,
  COMMUNICATION_CATEGORIES,
  type Theme,
  type Locale,
  type JobRole,
  type PreferencesDto,
} from "@/lib/experience/catalog";
export function AppearanceChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
  disabled?: boolean;
}) {
  const { t } = useExperience();
  return (
    <fieldset disabled={disabled} className="experience-options">
      <legend>{t("settings", "appearance")}</legend>
      {THEMES.map((theme) => (
        <label
          key={theme}
          className="experience-choice"
          data-selected={value === theme}
        >
          <input
            type="radio"
            name="theme"
            value={theme}
            checked={value === theme}
            onChange={() => onChange(theme)}
          />
          <span
            className="experience-theme-sample"
            data-sample={theme}
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
          </span>
          <span>{t("common", theme === "LIGHT" ? "light" : "dark")}</span>
        </label>
      ))}
    </fieldset>
  );
}
export function LanguageChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: Locale;
  onChange: (locale: Locale) => void;
  disabled?: boolean;
}) {
  const { t } = useExperience();
  return (
    <fieldset disabled={disabled} className="experience-options">
      <legend>{t("settings", "language")}</legend>
      {SUPPORTED_LOCALES.map((locale) => (
        <label
          key={locale}
          className="experience-choice"
          data-selected={value === locale}
        >
          <input
            type="radio"
            name="locale"
            value={locale}
            checked={value === locale}
            onChange={() => onChange(locale)}
          />
          <span lang={locale}>{LOCALE_CATALOG[locale].label}</span>
        </label>
      ))}
    </fieldset>
  );
}
export function RoleChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: JobRole | null;
  onChange: (role: JobRole) => void;
  disabled?: boolean;
}) {
  const { t } = useExperience();
  return (
    <fieldset
      disabled={disabled}
      className="experience-options experience-roles"
    >
      <legend>{t("settings", "role")}</legend>
      {JOB_ROLES.map((role) => (
        <label
          key={role}
          className="experience-choice"
          data-selected={value === role}
        >
          <input
            type="radio"
            name="jobRole"
            value={role}
            checked={value === role}
            onChange={() => onChange(role)}
          />
          <span>{t("onboarding", role)}</span>
        </label>
      ))}
    </fieldset>
  );
}
export function Communications({
  values,
  available,
  disabled = false,
  onChange,
}: {
  values: PreferencesDto["communications"];
  available: boolean;
  disabled?: boolean;
  onChange?: (
    key: (typeof COMMUNICATION_CATEGORIES)[number],
    checked: boolean,
  ) => void;
}) {
  const { t } = useExperience();
  return (
    <div className="experience-communications">
      <h3>{t("settings", "essential")}</h3>
      <p className="experience-help">{t("settings", "essentialHelp")}</p>
      <fieldset disabled={disabled}>
        <legend>{t("settings", "communications")}</legend>
        {COMMUNICATION_CATEGORIES.map((key) => (
          <label className="experience-check" key={key}>
            <input
              type="checkbox"
              name={key}
              checked={values[key]}
              disabled={!available && !values[key]}
              aria-describedby="communication-availability"
              onChange={(event) => onChange?.(key, event.target.checked)}
            />
            <span>{t("settings", key)}</span>
          </label>
        ))}
      </fieldset>
      <p id="communication-availability" className="experience-help">
        {!available ? t("settings", "blocked") : t("settings", "distinct")}
      </p>
      <p className="experience-help">{t("settings", "distinct")}</p>
    </div>
  );
}
