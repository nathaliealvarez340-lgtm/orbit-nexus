"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreferencesDto } from "@/lib/experience/catalog";
import type { PreferencesUpdate } from "@/lib/experience/validation";
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
import { FormFeedback } from "@/components/forms/form-feedback";
export function PreferencesSettings({ initial }: { initial: PreferencesDto }) {
  const [preferences, setPreferences] = useState(initial);
  const [serverSnapshot, setServerSnapshot] = useState(initial);
  if (serverSnapshot !== initial) {
    setServerSnapshot(initial);
    if (initial.revision >= preferences.revision) setPreferences(initial);
  }
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string>();
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const router = useRouter();
  const { preview, t } = useExperience();
  async function update(change: PreferencesUpdate) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setErrorCode(undefined);
    setSaved(false);
    try {
      const confirmed = await savePreferences({
        ...change,
        revision: preferences.revision,
      });
      setPreferences((current) =>
        confirmed.revision >= current.revision ? confirmed : current,
      );
      preview(confirmed);
      setSaved(true);
      router.refresh();
    } catch (error) {
      setErrorCode(
        error instanceof PreferencesUiError ? error.code : "unavailable",
      );
      try {
        const current = await loadPreferences();
        setPreferences((previous) =>
          current.revision >= previous.revision ? current : previous,
        );
        preview(current);
      } catch {
        preview(preferences);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="experience-settings surface"
      aria-label={t("settings", "description")}
      aria-busy={busy}
    >
      <div className="experience-setting">
        <AppearanceChoice
          value={preferences.theme}
          disabled={busy}
          onChange={(theme) => void update({ theme })}
        />
      </div>
      <div className="experience-setting">
        <LanguageChoice
          value={preferences.locale}
          disabled={busy}
          onChange={(locale) => void update({ locale })}
        />
      </div>
      <div className="experience-setting">
        <RoleChoice
          value={preferences.jobRole}
          disabled={busy}
          onChange={(jobRole) => void update({ jobRole })}
        />
      </div>
      <div className="experience-setting">
        <Communications
          values={preferences.communications}
          available={preferences.communicationsAvailable}
          disabled={busy}
          onChange={(category, enabled) =>
            void update({ communications: { [category]: enabled } })
          }
        />
      </div>
      <FormFeedback
        message={
          errorCode
            ? t("errors", errorCode as "unavailable")
            : saved
              ? t("common", "saved")
              : ""
        }
        busy={busy}
        error={!!errorCode}
      />
    </section>
  );
}
