"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export const navigation = [
  {
    title: "PRINCIPAL",
    links: [
      ["/dashboard", "Dashboard"],
      ["/dashboard/reports", "Reportes"],
      ["/dashboard/notifications", "Notificaciones"],
      ["/dashboard/support", "Soporte"],
    ],
  },
  {
    title: "ADMINISTRACIÓN",
    links: [
      ["/dashboard/companies", "Empresas"],
      ["/dashboard/fiscal-profile", "Perfil fiscal"],
      ["/dashboard/user", "Usuario"],
    ],
  },
  {
    title: "FACTURACIÓN · FACTURAS",
    links: [
      ["/dashboard/invoices/new", "Nueva factura"],
      ["/dashboard/invoices/settings", "Administración de facturas"],
      ["/dashboard/invoices/issued", "CFDI emitidos"],
      ["/dashboard/tickets", "Tickets"],
      ["/dashboard/invoices", "CFDI recibidos"],
      ["/dashboard/fiscal-documents", "Documentos fiscales"],
    ],
  },
  { title: "CATÁLOGO", links: [["/dashboard/clients", "Clientes"]] },
  {
    title: "ACCESO RÁPIDO",
    links: [
      ["/dashboard/invoices/new", "Nueva factura"],
      ["/dashboard/tickets/new", "Realizar ticket"],
    ],
  },
];
export function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menú principal" className="space-y-5">
      {navigation.map((group) => (
        <details key={group.title} open>
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold tracking-widest text-zinc-500">
            {group.title}
          </summary>
          <ul className="space-y-1">
            {group.links.map(([href, label]) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={pathname === href ? "page" : undefined}
                  className={
                    "block rounded-xl px-3 py-2 text-sm transition-colors " +
                    (pathname === href
                      ? "bg-white/10 text-white"
                      : "text-zinc-400 hover:bg-white/5 hover:text-white")
                  }
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
}
