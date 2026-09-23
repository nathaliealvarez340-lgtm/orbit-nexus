"use client";

import {
  Building2,
  FileArchive,
  LayoutDashboard,
  ReceiptText,
  Settings2,
  Stamp,
  UserRoundCog,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Resumen", icon: LayoutDashboard },
  { href: "/dashboard/tickets", label: "Tickets", icon: ReceiptText },
  { href: "/dashboard/invoices", label: "Facturas", icon: FileArchive },
  { href: "/dashboard/companies", label: "Empresas", icon: Building2 },
  {
    href: "/dashboard/fiscal-profile",
    label: "Perfil fiscal",
    icon: UserRoundCog,
  },
  {
    href: "/dashboard/fiscal-documents",
    label: "Documentos",
    icon: FileArchive,
  },
  { href: "/dashboard/stamping", label: "Timbrado", icon: Stamp },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/[.07] bg-[#09090b]/95 p-4 backdrop-blur-xl lg:flex lg:flex-col">
      <div className="px-2 py-3">
        <Logo />
      </div>
      <nav className="mt-6 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                active
                  ? "bg-white/[.08] text-white"
                  : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-2xl border border-violet-500/20 bg-violet-500/[.07] p-4">
        <WandSparkles className="size-4 text-violet-400" />
        <p className="mt-3 text-sm font-medium">Tu operación, conectada</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Captura, revisa y confirma cada comprobante.
        </p>
      </div>
      <Link
        href="/onboarding"
        className="mt-3 flex items-center gap-3 px-3 py-2 text-sm text-zinc-500"
      >
        <Settings2 className="size-4" />
        Organizaciones
      </Link>
    </aside>
  );
}
