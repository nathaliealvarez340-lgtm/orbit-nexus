"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePrivacyLayer } from "./privacy-layer";
import { Button } from "@/components/ui/button";
import { usePathname } from "next/navigation";
import { useWebConsent, saveWebConsent } from "@/lib/web-consent";
const subscribeHydration = () => () => {};
export function CookiePreferencesButton({
  label = "Cambiar preferencias de cookies",
}: {
  label?: string;
}) {
  return (
    <Button
      variant="secondary"
      className="min-h-11 h-auto"
      onClick={() => window.dispatchEvent(new Event("orbit:preferences"))}
    >
      {label}
    </Button>
  );
}
export function CookieConsent() {
  const pathname = usePathname();
  const consent = useWebConsent();
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const [configure, setConfigure] = useState(false),
    [requested, setRequested] = useState(false),
    [analytics, setAnalytics] = useState(false);
  const [error, setError] = useState("");
  const open = hydrated && (!consent || requested);
  const privacy = usePrivacyLayer();
  const placement = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const show = () => {
      trigger.current = document.activeElement as HTMLElement;
      setAnalytics(consent?.analytics ?? false);
      setConfigure(true);
      setRequested(true);
      setError("");
    };
    window.addEventListener("orbit:preferences", show);
    return () => window.removeEventListener("orbit:preferences", show);
  }, [consent]);
  useEffect(() => {
    if (requested) heading.current?.focus();
  }, [requested, privacy?.host]);
  useEffect(() => {
    const element = placement.current,
      app = document.querySelector<HTMLElement>(".orbit-app");
    if (!element) return;
    const measure = () => {
      const space = `${Math.max(0, privacy?.host ? 0 : window.innerHeight - element.getBoundingClientRect().top)}px`;
      document.documentElement.style.setProperty(
        "--orbit-privacy-space",
        space,
      );
      app?.style.setProperty("--orbit-privacy-space", space);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      app?.style.removeProperty("--orbit-privacy-space");
      document.documentElement.style.removeProperty("--orbit-privacy-space");
    };
  }, [open, configure, privacy?.host, pathname]);
  function save(allowed: boolean) {
    if (!saveWebConsent(allowed)) {
      setError(
        "Tu navegador no pudo guardar la elección. Revisa la configuración de cookies; las analíticas permanecen desactivadas.",
      );
      return;
    }
    setRequested(false);
    setConfigure(false);
    setError("");
    trigger.current?.focus();
  }
  if (!hydrated) return null;
  // On reading surfaces, the permanent footer control opens this same banner.
  // Avoid placing a floating control over the legal text once a choice exists.
  if (
    consent &&
    !requested &&
    ["/privacy", "/terms", "/cookies"].includes(pathname)
  )
    return null;
  const content = (
    <div
      ref={placement}
      className={`orbit-cookie-layer${privacy?.host ? " orbit-cookie-modal" : ""}`}
    >
      {!open ? (
        <button
          type="button"
          className="orbit-cookie-preferences rounded-lg border border-white/10 bg-[#111115] px-3 text-xs text-zinc-300"
          onClick={() => window.dispatchEvent(new Event("orbit:preferences"))}
        >
          Preferencias de cookies
        </button>
      ) : (
        <section
          aria-label="Preferencias de cookies"
          className="orbit-cookie-banner overflow-y-auto rounded-2xl border border-white/10 bg-[#121216] p-5 text-white shadow-2xl"
          onKeyDown={(event) => {
            if (event.key === "Escape" && consent) {
              setRequested(false);
              trigger.current?.focus();
            }
          }}
        >
          <h2 ref={heading} tabIndex={-1} className="text-sm font-medium">
            Tu privacidad en Orbit
          </h2>
          <p className="mt-2 text-xs leading-5 text-zinc-300">
            Las cookies de sesión y seguridad son necesarias. Tú decides si
            permites medir visitas con analíticas opcionales.
          </p>
          <nav
            aria-label="Políticas de cookies"
            className="mt-2 flex flex-wrap gap-x-4 text-xs text-violet-300"
          >
            <Link href="/privacy">Privacidad</Link>
            <Link href="/cookies">Cookies</Link>
            <Link href="/terms">Términos</Link>
          </nav>
          {configure && (
            <div className="mt-3 space-y-3 rounded-xl border border-white/10 p-3">
              <p className="text-sm">
                ESSENTIAL · Siempre activas
                <span className="mt-1 block text-xs text-zinc-300">
                  Autenticación, seguridad y preferencias. No se pueden
                  desactivar aquí.
                </span>
              </p>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(event) => setAnalytics(event.target.checked)}
                  className="mt-1 size-5 accent-violet-500"
                />
                <span>
                  ANALYTICS · Analíticas opcionales
                  <span className="mt-1 block text-xs text-zinc-300">
                    Medir visitas generales sin datos de cuenta ni fiscales.
                  </span>
                </span>
              </label>
              {consent && (
                <p className="text-xs text-zinc-300">
                  Última elección:{" "}
                  <time dateTime={consent.chosenAt}>
                    {new Date(consent.chosenAt).toLocaleDateString("es-MX")}
                  </time>
                </p>
              )}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              className="!min-h-11 !h-auto !text-xs"
              variant="secondary"
              onClick={() => save(false)}
            >
              Rechazar analíticas
            </Button>
            <Button
              className="!min-h-11 !h-auto !text-xs"
              variant="secondary"
              onClick={() => save(configure ? analytics : true)}
            >
              {configure ? "Aceptar selección" : "Aceptar analíticas"}
            </Button>
            {!configure && (
              <Button
                variant="ghost"
                className="!min-h-11 !h-auto !text-xs"
                onClick={() => {
                  setAnalytics(consent?.analytics ?? false);
                  setConfigure(true);
                }}
              >
                Configurar
              </Button>
            )}
            {consent && (
              <Button
                variant="ghost"
                className="!min-h-11 !h-auto !text-xs"
                onClick={() => {
                  setRequested(false);
                  trigger.current?.focus();
                }}
              >
                Cerrar sin cambios
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
  return privacy?.host ? createPortal(content, privacy.host) : content;
}
