"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Consent } from "@/lib/consent";
export function CookieConsent({ initial }: { initial: Consent | null }) {
  const [open, setOpen] = useState(!initial);
  const [configure, setConfigure] = useState(false);
  const [analytics, setAnalytics] = useState(initial?.analytics ?? false);
  const [marketing, setMarketing] = useState(initial?.marketing ?? false);
  function save(a: boolean, m: boolean) {
    const value: Consent = {
      version: 1,
      necessary: true,
      analytics: a,
      marketing: m,
    };
    document.cookie =
      "orbit.consent=" +
      encodeURIComponent(JSON.stringify(value)) +
      "; Max-Age=15552000; Path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
    setAnalytics(a);
    setMarketing(m);
    setOpen(false);
    window.dispatchEvent(new CustomEvent("orbit:consent", { detail: value }));
  }
  if (!open)
    return (
      <button
        className="fixed bottom-3 left-3 z-30 rounded-lg border border-white/10 bg-[#111115] px-2 py-1 text-[10px] text-zinc-400"
        onClick={() => {
          setConfigure(true);
          setOpen(true);
        }}
      >
        Preferencias de cookies
      </button>
    );
  return (
    <section
      role="region"
      aria-label="Preferencias de cookies"
      className="fixed bottom-5 left-5 right-5 z-50 max-h-[85dvh] max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#121216] p-5 text-white shadow-2xl"
    >
      <h2 className="text-sm font-medium">Tu privacidad en Orbit</h2>
      <p className="mt-2 text-xs leading-5 text-zinc-400">
        Las cookies de sesión y seguridad son necesarias. Tú decides sobre
        analítica y marketing. Esta versión no carga rastreadores opcionales.
      </p>
      <div className="mt-2 flex gap-4 text-xs text-violet-300">
        <Link href="/privacy">Privacidad</Link>
        <Link href="/cookies">Cookies</Link>
        <Link href="/terms">Términos</Link>
      </div>
      {configure && (
        <div className="mt-4 space-y-4 rounded-xl border border-white/10 p-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked
              disabled
              className="mt-1 accent-violet-500"
            />
            <span>
              Necesarias
              <span className="mt-1 block text-xs text-zinc-500">
                Autenticación, seguridad, organización activa y tus
                preferencias. Siempre habilitadas.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              className="mt-1 accent-violet-500"
            />
            <span>
              Analíticas
              <span className="mt-1 block text-xs text-zinc-500">
                Medición de uso, solo si se integra un proveedor y das permiso.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
              className="mt-1 accent-violet-500"
            />
            <span>
              Marketing
              <span className="mt-1 block text-xs text-zinc-500">
                Publicidad personalizada, solo con una integración y tu permiso.
              </span>
            </span>
          </label>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="!h-9 !text-xs"
          variant="secondary"
          onClick={() => save(false, false)}
        >
          Rechazar no esenciales
        </Button>
        <Button className="!h-9 !text-xs" onClick={() => save(true, true)}>
          Aceptar todas
        </Button>
        {configure ? (
          <Button
            variant="ghost"
            className="!h-9 !text-xs"
            onClick={() => save(analytics, marketing)}
          >
            Guardar preferencias
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="!h-9 !text-xs"
            onClick={() => setConfigure(true)}
          >
            Configurar
          </Button>
        )}
      </div>
    </section>
  );
}
