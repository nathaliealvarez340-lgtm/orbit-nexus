"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { registerSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { FormFeedback } from "@/components/forms/form-feedback";
import { useExperience } from "./experience-provider";
import {
  AppearanceChoice,
  LanguageChoice,
  RoleChoice,
  Communications,
} from "./preference-controls";
import {
  loadPreferences,
  savePreferences,
  PreferencesUiError,
} from "./transport";
import type { JobRole, PreferencesDto } from "@/lib/experience/catalog";

const steps = [
  "appearance",
  "language",
  "communications",
  "profile",
  "account",
] as const;
const titles = [
  "appearanceTitle",
  "languageTitle",
  "communicationsTitle",
  "profileTitle",
  "accountTitle",
] as const;
export function RegistrationWizard({
  existing,
}: {
  existing?: PreferencesDto;
}) {
  const { value, preview, t } = useExperience();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<JobRole | null>(existing?.jobRole ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [created, setCreated] = useState(!!existing);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [accountFields, setAccountFields] = useState({
    givenName: "",
    familyName: "",
    email: "",
  });
  const stepsCount = existing ? 4 : 5;
  const finalStep = step === stepsCount - 1;
  function move(next: number) {
    const retained = { ...accountFields };
    for (const key of ["givenName", "familyName", "email"] as const) {
      const input = form.current?.elements.namedItem(key);
      if (input instanceof HTMLInputElement) retained[key] = input.value;
    }
    setAccountFields(retained);
    form.current
      ?.querySelectorAll<HTMLInputElement>(
        'input[type="password"], input[name="password"], input[name="confirm"]',
      )
      .forEach((input) => {
        input.value = "";
      });
    setStep(next);
    setError("");
    setFields([]);
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function finish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!finalStep) {
      if (!busy) move(step + 1);
      return;
    }
    if (lock.current || !role || uncertain) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setFields([]);
    let accountCreated = created;
    try {
      if (!accountCreated) {
        const data = new FormData(event.currentTarget);
        const givenName = String(data.get("givenName") ?? "").trim(),
          familyName = String(data.get("familyName") ?? "").trim();
        const name = [givenName, familyName].join(" ");
        const result = registerSchema.safeParse({
          name,
          email: String(data.get("email") ?? "")
            .trim()
            .toLowerCase(),
          password: data.get("password"),
          confirm: data.get("confirm"),
        });
        if (!givenName || !familyName || !result.success) {
          setFields(
            result.success
              ? ["givenName", "familyName"]
              : result.error.issues.map((issue) =>
                  issue.path[0] === "name"
                    ? "givenName"
                    : String(issue.path[0]),
                ),
          );
          setError(t("auth", "review"));
          return;
        }
        // Passwords exist only in this request and uncontrolled DOM inputs.
        event.currentTarget
          .querySelectorAll<HTMLInputElement>(
            'input[name="password"], input[name="confirm"]',
          )
          .forEach((input) => {
            input.value = "";
          });
        const response = await authClient.signUp.email({
          name: result.data.name,
          email: result.data.email,
          password: result.data.password,
          givenName,
          familyName,
        });
        if (response.error) {
          setError(t("auth", "failed"));
          return;
        }
        if (!response.data?.user) {
          setUncertain(true);
          setError(t("auth", "uncertain"));
          return;
        }
        accountCreated = true;
        setCreated(true);
      }
      const current = await loadPreferences();
      await savePreferences({
        theme: value.theme,
        locale: value.locale,
        jobRole: role,
        revision: current.revision,
        completeOnboarding: true,
        communications: {
          NEWS_UPDATES: false,
          PRODUCT_NEWS: false,
          COMMERCIAL_OFFERS: false,
        },
      });
      // Session and authorized membership are resolved by the existing backend.
      // Discard the unauthenticated router cache after establishing the session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/api/auth/continue");
    } catch (failure) {
      if (failure instanceof PreferencesUiError)
        setError(t("errors", failure.code as "unavailable"));
      else {
        if (!accountCreated) setUncertain(true);
        setError(t("auth", accountCreated ? "connection" : "uncertain"));
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="registration-wizard">
      <aside className="wizard-context">
        <h1>{t("onboarding", "title")}</h1>
        <p className="experience-help">{t("onboarding", "intro")}</p>
        <ol
          className="wizard-progress"
          aria-label={t("onboarding", "step", {
            current: step + 1,
            total: stepsCount,
          })}
        >
          {steps.slice(0, stepsCount).map((key, index) => (
            <li
              key={key}
              aria-current={index === step ? "step" : undefined}
              data-complete={index < step}
            >
              <span aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{t("onboarding", key)}</span>
            </li>
          ))}
        </ol>
      </aside>
      <form
        ref={form}
        className="wizard-form"
        onSubmit={finish}
        aria-busy={busy}
      >
        <p className="experience-help wizard-step" role="status">
          {t("onboarding", "step", { current: step + 1, total: stepsCount })}
        </p>
        <h2 ref={heading} tabIndex={-1}>
          {t("onboarding", titles[step])}
        </h2>
        {step === 0 && (
          <>
            <p className="experience-help">
              {t("onboarding", "appearanceHelp")}
            </p>
            <AppearanceChoice
              value={value.theme}
              disabled={busy}
              onChange={(theme) => preview({ theme })}
            />
          </>
        )}
        {step === 1 && (
          <>
            <p className="experience-help">{t("onboarding", "languageHelp")}</p>
            <LanguageChoice
              value={value.locale}
              disabled={busy}
              onChange={(locale) => preview({ locale })}
            />
          </>
        )}
        {step === 2 && (
          <Communications
            values={
              existing?.communications ?? {
                NEWS_UPDATES: false,
                PRODUCT_NEWS: false,
                COMMERCIAL_OFFERS: false,
              }
            }
            available={false}
            disabled={busy}
          />
        )}
        {step === 3 && (
          <RoleChoice value={role} disabled={busy} onChange={setRole} />
        )}
        {step === 4 && !created && (
          <fieldset disabled={busy} className="wizard-account">
            <legend>{t("common", "account")}</legend>
            {(["givenName", "familyName", "email"] as const).map((key) => (
              <label key={key}>
                {t("common", key)}
                <input
                  className="input"
                  name={key}
                  defaultValue={accountFields[key]}
                  required
                  autoComplete={
                    {
                      givenName: "given-name",
                      familyName: "family-name",
                      email: "email",
                    }[key]
                  }
                  type={key === "email" ? "email" : "text"}
                  maxLength={key === "email" ? 254 : 100}
                />
              </label>
            ))}
            {(["password", "confirm"] as const).map((key) => (
              <label key={key}>
                {t("common", key === "password" ? "passwordLabel" : "confirm")}
                <PasswordInput
                  name={key}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
            ))}
            <p className="experience-help">{t("auth", "policy")}</p>
            <p className="experience-help">{t("auth", "legal")}</p>
            <div className="legal-links">
              <Link href="/terms">{t("common", "terms")}</Link>
              <Link href="/privacy">{t("common", "privacy")}</Link>
            </div>
          </fieldset>
        )}
        {created && (
          <p role="status" className="experience-help">
            {t("auth", "resume")}
          </p>
        )}
        <div className="wizard-actions">
          {step > 0 && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => move(step - 1)}
            >
              {t("common", "back")}
            </Button>
          )}
          {finalStep ? (
            <Button type="submit" disabled={busy || !role || uncertain}>
              {busy
                ? t("common", "saving")
                : created
                  ? t("common", "continue")
                  : t("auth", "create")}
            </Button>
          ) : (
            <Button
              disabled={busy || (step === 3 && !role)}
              onClick={() => move(step + 1)}
            >
              {t("common", "continue")}
            </Button>
          )}
        </div>
        <FormFeedback message={error} error={!!error} fields={fields} />
        {uncertain && (
          <Link href="/login" className="underline">
            {t("auth", "login")}
          </Link>
        )}
        {!existing && (
          <p className="experience-help">
            {t("auth", "existing")}{" "}
            <Link className="underline" href="/login">
              {t("auth", "login")}
            </Link>
          </p>
        )}
      </form>
    </div>
  );
}
