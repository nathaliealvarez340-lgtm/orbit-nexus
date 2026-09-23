"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
export function OrganizationForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  return (
    <form
      className="mt-7 space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
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
            setError(data.error);
            return;
          }
          // A new workspace must not reuse a previously cached tenant layout.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/dashboard");
          navigating = true;
        } catch {
          setError("No fue posible conectar.");
        } finally {
          if (!navigating) {
            lock.current = false;
            setBusy(false);
          }
        }
      }}
    >
      <label className="block text-sm text-zinc-400">
        Nombre de empresa u organización
        <input
          className="input mt-2"
          name="name"
          required
          minLength={2}
          maxLength={100}
          placeholder="Tu organización"
        />
      </label>
      <Button
        type="submit"
        className="w-full disabled:opacity-50"
        disabled={busy}
      >
        {busy ? "Creando…" : "Crear organización"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
