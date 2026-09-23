"use client";
import { useState } from "react";
export function OrganizationSwitcher({
  memberships,
  active,
}: {
  memberships: { organization: { id: string; name: string } }[];
  active?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <select
        aria-label="Organización activa"
        className="input max-w-[48vw] text-sm sm:max-w-64"
        value={active || ""}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError("");
          try {
            const res = await fetch("/api/organizations/active", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ organizationId: e.target.value }),
            });
            if (!res.ok) throw new Error();
            // Clear all cached tenant pages when changing the session's workspace.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/dashboard");
          } catch {
            setError("No se pudo cambiar de organización.");
            setBusy(false);
          }
        }}
      >
        {!active && (
          <option value="" disabled>
            Seleccionar organización
          </option>
        )}
        {memberships.map((m) => (
          <option key={m.organization.id} value={m.organization.id}>
            {m.organization.name}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
