"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { LogOut } from "lucide-react";
export function LogoutButton() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <button
        disabled={busy}
        className="flex items-center gap-3 rounded-xl p-3 text-sm text-zinc-400"
        onClick={async () => {
          setBusy(true);
          try {
            const result = await authClient.signOut();
            if (result.error) throw new Error();
            // Discard the authenticated router cache after session revocation.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/login");
          } catch {
            setError("No se pudo cerrar sesión.");
            setBusy(false);
          }
        }}
      >
        <LogOut className="size-4" />
        Cerrar sesión
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
