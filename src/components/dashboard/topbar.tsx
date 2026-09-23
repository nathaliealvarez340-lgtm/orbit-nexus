"use client";
import Link from "next/link";
import { LogOut, Plus } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { OrganizationSwitcher } from "./organization-switcher";
export function Topbar({
  user,
  organizationId,
  memberships,
}: {
  user: { name: string };
  organizationId: string;
  memberships: { organization: { id: string; name: string } }[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#0c0c0f]/95 backdrop-blur-xl">
      <div className="flex min-h-16 items-center justify-between gap-3 px-5 py-2 md:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <OrganizationSwitcher
            memberships={memberships}
            active={organizationId}
          />
          <Link
            href="/onboarding"
            aria-label="Crear otra organización"
            className="p-2 text-zinc-500"
          >
            <Plus className="size-4" />
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-zinc-400 sm:block">
            {user.name}
          </span>
          <button
            disabled={busy}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="rounded-xl border border-white/10 p-2.5 text-zinc-400"
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
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="px-5 text-xs text-red-400">
          {error}
        </p>
      )}
      <nav
        aria-label="Navegación móvil"
        className="flex gap-5 overflow-x-auto border-t border-white/[.05] px-5 py-3 text-xs text-zinc-400 lg:hidden"
      >
        {[
          ["/dashboard", "Resumen"],
          ["/dashboard/tickets", "Tickets"],
          ["/dashboard/invoices", "Facturas"],
          ["/dashboard/fiscal-profile", "Perfil fiscal"],
          ["/dashboard/fiscal-documents", "Documentos"],
          ["/dashboard/companies", "Empresas"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="whitespace-nowrap">
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
