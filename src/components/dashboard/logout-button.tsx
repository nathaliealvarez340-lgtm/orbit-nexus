"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { LogOut } from "lucide-react";
export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <button
        disabled={busy}
        aria-label="Cerrar sesión"
        data-tooltip="Cerrar sesión"
        className="orbit-logout orbit-nav-item"
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
        <LogOut className="orbit-nav-icon" aria-hidden="true" />
        {!compact && <span>Cerrar sesión</span>}
      </button>
      {error && (
        <p role="alert" className="orbit-logout-error text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
