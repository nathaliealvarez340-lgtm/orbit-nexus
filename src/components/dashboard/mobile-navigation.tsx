"use client";
import { useRef } from "react";
import { Menu, X } from "lucide-react";
import { Navigation } from "./navigation";
import { LogoutButton } from "./logout-button";
export function MobileNavigation() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Abrir menú"
        className="rounded-lg p-3"
        onClick={() => dialog.current?.showModal()}
      >
        <Menu className="size-5" />
      </button>
      <dialog
        aria-label="Menú de navegación"
        ref={dialog}
        className="m-0 h-dvh max-h-dvh w-80 max-w-[90vw] border-r border-white/10 bg-[#0c0c0f] p-4 text-white backdrop:bg-black/70"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="font-medium">ORBIT NEXUS</p>
          <button
            className="p-3"
            type="button"
            aria-label="Cerrar menú"
            onClick={() => dialog.current?.close()}
          >
            <X className="size-5" />
          </button>
        </div>
        <Navigation onNavigate={() => dialog.current?.close()} />
        <div className="mt-5 border-t border-white/10 pt-3">
          <LogoutButton />
        </div>
      </dialog>
    </div>
  );
}
