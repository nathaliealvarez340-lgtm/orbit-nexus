"use client";
import { useExperience } from "@/components/experience/experience-provider";
import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { registerSchema } from "@/lib/validation";
import { FormFeedback } from "./form-feedback";

export function AuthForm({
  mode,
  returnTo,
}: {
  mode: "login" | "register";
  returnTo?: "/dashboard/stamping";
}) {
  const { t } = useExperience();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    if (mode === "register") {
      const result = registerSchema.safeParse(fields);
      if (!result.success) {
        setInvalidFields(
          result.error.issues.map((issue) => String(issue.path[0])),
        );
        setError(
          t("auth", "review"),
        );
        return;
      }
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setInvalidFields([]);
    let navigating = false;
    try {
      const credentials = {
        email: String(fields.email).trim().toLowerCase(),
        password: String(fields.password),
      };
      e.currentTarget.querySelectorAll<HTMLInputElement>('input[name="password"], input[name="confirm"]').forEach((input) => { input.value = ""; });
      const response =
        mode === "register"
          ? await authClient.signUp.email({
              ...credentials,
              name: String(fields.name).trim(),
            })
          : await authClient.signIn.email(credentials);
      if (response.error) {
        setError(
          mode === "login"
            ? t("auth", "loginFailed")
            : t("auth", "failed"),
        );
        return;
      }
      if (!response.data?.user) throw new Error("SESSION_NOT_CREATED");
      // Server resolves the session and membership; discard pre-login router cache.
      window.location.assign(
        mode === "login" && returnTo === "/dashboard/stamping"
          ? "/dashboard/stamping"
          : "/api/auth/continue",
      );
      navigating = true;
    } catch {
      setError(t("auth", "connection"));
    } finally {
      if (!navigating) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <form onSubmit={submit} className="mt-8 space-y-4" aria-busy={busy}>
      {mode === "register" && (
        <Field label={t("common", "givenName")}>
          <input
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
            className="input"
            placeholder="Tu nombre"
          />
        </Field>
      )}
      <Field label={t("common", "email")}>
        <input
          name="email"
          autoComplete="email"
          className="input"
          type="email"
          required
          maxLength={254}
          placeholder="nombre@empresa.com"
        />
      </Field>
      <Field label={t("common", "passwordLabel")}>
        <PasswordInput
          name="password"
          autoComplete={
            mode === "register" ? "new-password" : "current-password"
          }
          className="input"
          type="password"
          required
          minLength={mode === "register" ? 12 : 1}
          maxLength={128}
          placeholder="••••••••"
        />
      </Field>
      {mode === "register" && (
        <>
          <p className="text-xs text-zinc-500">
            {t("auth", "policy")}
          </p>
          <Field label={t("common", "confirm")}>
            <PasswordInput
              name="confirm"
              autoComplete="new-password"
              className="input"
              type="password"
              required
              placeholder="••••••••"
            />
          </Field>
        </>
      )}
      {mode === "login" && (
        <Link
          className="block text-right text-xs text-violet-300"
          href="/forgot-password"
        >
          {t("auth", "recover")}
        </Link>
      )}
      <Button
        disabled={busy}
        type="submit"
        className="h-11 w-full disabled:opacity-50"
      >
        {busy
          ? t("auth", "wait")
          : mode === "login"
            ? t("auth", "login")
            : t("auth", "create")}
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ArrowRight className="size-4" />
        )}
      </Button>
      <FormFeedback
        message={error}
        error={!!error}
        busy={busy}
        fields={invalidFields}
      />
    </form>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm text-zinc-400">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}
