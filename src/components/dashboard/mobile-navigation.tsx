"use client";
import { useRef } from "react";
import { Menu, X } from "lucide-react";
import { Navigation } from "./navigation";
import { LogoutButton } from "./logout-button";
import { Logo } from "@/components/brand/logo";
import { usePrivacyLayer } from "@/components/privacy/privacy-layer";
export function MobileNavigation() {
  const dialog = useRef<HTMLDialogElement>(null);
  const privacy = usePrivacyLayer();
  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Abrir menú"
        aria-haspopup="dialog"
        className="rounded-lg p-3"
        onClick={() => {
          dialog.current?.showModal();
          privacy?.setHost(dialog.current);
        }}
      >
        <Menu className="size-5" />
      </button>
      <dialog
        aria-label="Menú de navegación"
        ref={dialog}
        className="orbit-mobile-navigation orbit-nav-panel"
        onClose={() => privacy?.setHost(null)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.target === e.currentTarget &&
            (e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom)
          )
            dialog.current?.close();
        }}
      >
        <div className="orbit-mobile-header">
          <Logo />
          <button
            className="p-3"
            type="button"
            aria-label="Cerrar menú"
            onClick={() => dialog.current?.close()}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="orbit-sidebar-scroll">
          <Navigation onNavigate={() => dialog.current?.close()} />
        </div>
        <div className="orbit-sidebar-footer">
          <LogoutButton />
        </div>
      </dialog>
    </div>
  );
}
