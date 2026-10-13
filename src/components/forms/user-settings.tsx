"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { passwordSchema } from "@/lib/validation";
import { PasswordInput } from "@/components/ui/password-input";
import { useExperience } from "@/components/experience/experience-provider";
import { Button } from "@/components/ui/button";
export function UserSettings({
  name,
  email,
  accent,
  givenName,
  familyName,
}: {
  name: string;
  email: string;
  accent: string;
  givenName?: string | null;
  familyName?: string | null;
}) {
  const { t } = useExperience();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <form
        className="surface space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          const values = new FormData(e.currentTarget);
          lock.current = true;
          setBusy(true);
          setMessage("");
          try {
            const result = await authClient.updateUser(
              givenName && familyName
                ? {
                    givenName: String(values.get("givenName")).trim(),
                    familyName: String(values.get("familyName")).trim(),
                  }
                : { name: String(values.get("name")).trim() },
            );
            if (result.error) throw new Error(t("errors", "unavailable"));
            const response = await fetch("/api/user/preferences", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accent: values.get("accent") }),
            });
            if (!response.ok) throw new Error(t("errors", "unavailable"));
            setMessage(t("common", "saved"));
            router.refresh();
          } catch {
            setMessage(t("errors", "unavailable"));
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <h2 className="font-medium">{t("common", "account")}</h2>
        {givenName && familyName ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {(["givenName", "familyName"] as const).map((field) => (
              <label className="block text-sm" key={field}>
                {t("common", field)}
                <input
                  className="input mt-2"
                  name={field}
                  defaultValue={field === "givenName" ? givenName : familyName}
                  autoComplete={
                    field === "givenName" ? "given-name" : "family-name"
                  }
                  required
                  maxLength={100}
                />
              </label>
            ))}
          </div>
        ) : (
          <label className="block text-sm">
            {t("common", "givenName")}
            <input
              className="input mt-2"
              name="name"
              defaultValue={name}
              required
              minLength={2}
              maxLength={100}
            />
          </label>
        )}
        <p className="break-all text-sm text-zinc-400">
          {t("common", "email")}: {email}
        </p>
        <label className="block text-sm">
          {t("settings", "accent")}
          <select name="accent" defaultValue={accent} className="input mt-2">
            <option value="PURPLE">{t("settings", "PURPLE")}</option>
            <option value="BLUE">{t("settings", "BLUE")}</option>
            <option value="ORANGE">{t("settings", "ORANGE")}</option>
            <option value="RED">{t("settings", "RED")}</option>
          </select>
        </label>
        <Button type="submit" disabled={busy}>
          {t("settings", "save")}
        </Button>
      </form>
      <form
        className="surface space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          const form = e.currentTarget,
            values = new FormData(form),
            currentPassword = String(values.get("current")),
            newPassword = String(values.get("new"));
          const validation = passwordSchema.safeParse(newPassword);
          if (!validation.success || newPassword !== values.get("confirm")) {
            setMessage(t("auth", "policy"));
            return;
          }
          lock.current = true;
          setBusy(true);
          setMessage("");
          form.reset();
          try {
            const result = await authClient.changePassword({
              currentPassword,
              newPassword,
              revokeOtherSessions: true,
            });
            if (result.error) throw new Error(t("settings", "passwordError"));
            form.reset();
            setMessage(t("settings", "passwordChanged"));
          } catch {
            setMessage(t("settings", "passwordError"));
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <h2 className="font-medium">{t("settings", "passwordTitle")}</h2>
        {[
          [
            "current",
            t("settings", "currentPasswordLabel"),
            "current-password",
          ],
          ["new", t("settings", "newPasswordLabel"), "new-password"],
          ["confirm", t("settings", "confirmPasswordLabel"), "new-password"],
        ].map(([field, label, autoComplete]) => (
          <label key={field} className="block text-sm">
            {label}
            <PasswordInput
              name={field}
              autoComplete={autoComplete}
              required
              maxLength={128}
              className="input mt-2"
            />
          </label>
        ))}
        <Button type="submit" disabled={busy}>
          {t("settings", "changePasswordLabel")}
        </Button>
      </form>
      <p className="text-sm text-violet-300 xl:col-span-2" role="status">
        {message}
      </p>
    </div>
  );
}
