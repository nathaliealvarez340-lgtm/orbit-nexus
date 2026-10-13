"use client";
import { useExperience } from "@/components/experience/experience-provider";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "./form-feedback";
import { errorFields } from "@/lib/form-errors";
export function OrganizationForm({
  next = "/dashboard",
}: {
  next?: "/dashboard" | "/dashboard/fiscal-profile";
}) {
  const { t } = useExperience();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const lock = useRef(false);
  return (
    <form
      className="mt-7 space-y-5"
      aria-busy={busy}
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        setFields([]);
        const name = new FormData(e.currentTarget).get("name");
        let navigating = false;
        try {
          const res = await fetch("/api/organizations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(t("errors", "organization"));
            setFields(errorFields(data, ["name"]));
            return;
          }
          // A new workspace must not reuse a previously cached tenant layout.
          window.location.assign(next);
          navigating = true;
        } catch {
          setError(t("auth", "connection"));
        } finally {
          if (!navigating) {
            lock.current = false;
            setBusy(false);
          }
        }
      }}
    >
      <label className="block text-sm text-zinc-400">
        {t("onboarding", "organizationName")}
        <input
          className="input mt-2"
          name="name"
          required
          minLength={2}
          maxLength={100}
          placeholder={t("onboarding", "organizationPlaceholder")}
        />
      </label>
      <Button
        type="submit"
        className="w-full disabled:opacity-50"
        disabled={busy}
      >
        {busy
          ? t("onboarding", "creating")
          : t("onboarding", "createOrganization")}
      </Button>
      <FormFeedback
        message={error}
        error={!!error}
        busy={busy}
        fields={fields}
      />
    </form>
  );
}
