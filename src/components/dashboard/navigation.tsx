"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Building2,
  ChartColumn,
  ChevronDown,
  CircleHelp,
  FileCheck2,
  FilePlus2,
  Files,
  FileText,
  FolderOpen,
  LayoutDashboard,
  List,
  ReceiptText,
  Settings2,
  ShieldUser,
  Ticket,
  TicketPlus,
  UserRound,
  UsersRound,
  WalletCards,
  Zap,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  label: string;
  icon: LucideIcon;
  href?: string;
  children?: { label: string; icon: LucideIcon; href: string }[];
};

const navigation: { title: string; icon: LucideIcon; items: NavItem[] }[] = [
  {
    title: "PRINCIPAL",
    icon: LayoutDashboard,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/dashboard/reports", label: "Reportes", icon: ChartColumn },
      { href: "/dashboard/notifications", label: "Notificaciones", icon: Bell },
      { href: "/dashboard/support", label: "Soporte", icon: CircleHelp },
    ],
  },
  {
    title: "ADMINISTRACIÓN",
    icon: ShieldUser,
    items: [
      { href: "/dashboard/companies", label: "Empresas", icon: Building2 },
      {
        href: "/dashboard/fiscal-profile",
        label: "Perfil fiscal",
        icon: FileText,
      },
      { href: "/dashboard/user", label: "Usuario", icon: UserRound },
    ],
  },
  {
    title: "FACTURACIÓN",
    icon: WalletCards,
    items: [
      {
        label: "Facturas",
        icon: ReceiptText,
        children: [
          {
            href: "/dashboard/invoices/new",
            label: "Nueva factura",
            icon: FilePlus2,
          },
          {
            href: "/dashboard/invoices/settings",
            label: "Administración de facturas",
            icon: Settings2,
          },
          {
            href: "/dashboard/invoices/issued",
            label: "CFDI emitidos",
            icon: FileCheck2,
          },
        ],
      },
      {
        href: "/dashboard/tickets",
        label: "Tickets",
        icon: Ticket,
        children: [
          { href: "/dashboard/invoices", label: "CFDI recibidos", icon: Files },
          {
            href: "/dashboard/fiscal-documents",
            label: "Documentos fiscales",
            icon: FolderOpen,
          },
        ],
      },
    ],
  },
  {
    title: "CATÁLOGO",
    icon: List,
    items: [
      { href: "/dashboard/clients", label: "Clientes", icon: UsersRound },
    ],
  },
  {
    title: "ACCESO RÁPIDO",
    icon: Zap,
    items: [
      {
        href: "/dashboard/invoices/new",
        label: "Nueva factura",
        icon: FilePlus2,
      },
      {
        href: "/dashboard/tickets/new",
        label: "Realizar ticket",
        icon: TicketPlus,
      },
    ],
  },
];

function matchesItem(item: NavItem, pathname: string): boolean {
  if (item.label === "Facturas")
    return /^\/dashboard\/invoices\/(new|settings|issued|drafts)(\/|$)/.test(
      pathname,
    );
  return Boolean(
    (item.href &&
      (pathname === item.href ||
        (item.href !== "/dashboard" &&
          pathname.startsWith(item.href + "/")))) ||
    item.children?.some((child) => pathname === child.href),
  );
}

type NavigationProps = {
  collapsed?: boolean;
  onExpand?: () => void;
  onNavigate?: () => void;
};

export function Navigation(props: NavigationProps) {
  const pathname = usePathname();
  // Reset accordion choices on navigation, revealing only the current module.
  return <NavigationGroups key={pathname} pathname={pathname} {...props} />;
}

function NavigationGroups({
  pathname,
  collapsed = false,
  onExpand,
  onNavigate,
}: NavigationProps & { pathname: string }) {
  const id = useId();
  const [openModule, setOpenModule] = useState<string | null>(
    () =>
      navigation
        .flatMap((group) => group.items)
        .find((item) => item.children && matchesItem(item, pathname))?.label ??
      null,
  );
  return (
    <nav
      aria-label="Menú principal"
      className="orbit-navigation"
      data-collapsed={collapsed}
    >
      {navigation.map((group, groupIndex) => (
        <section
          key={group.title}
          aria-labelledby={`${id}-${groupIndex}`}
          className="orbit-nav-section"
          data-active={group.items.some((item) => matchesItem(item, pathname))}
        >
          <h2 id={`${id}-${groupIndex}`} className="orbit-nav-heading">
            <group.icon aria-hidden="true" />
            {group.title}
          </h2>
          <ul>
            {group.items.map((item) => {
              const active = matchesItem(item, pathname);
              const open = !collapsed && openModule === item.label;
              const childrenId = `${id}-${groupIndex}-${item.label}`;
              const content = (
                <>
                  <item.icon className="orbit-nav-icon" aria-hidden="true" />
                  <span className="orbit-nav-label">{item.label}</span>
                </>
              );
              const toggle = () => {
                onExpand?.();
                setOpenModule(open ? null : item.label);
              };
              return (
                <li key={item.label}>
                  <div className="orbit-nav-row" data-active={active}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        aria-label={item.label}
                        data-tooltip={item.label}
                        aria-current={
                          pathname === item.href ? "page" : undefined
                        }
                        className="orbit-nav-item"
                        onClick={() => {
                          if (item.children) setOpenModule(item.label);
                          onNavigate?.();
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="orbit-nav-item"
                        aria-label={item.label}
                        data-tooltip={item.label}
                        aria-expanded={open}
                        aria-controls={childrenId}
                        onClick={toggle}
                      >
                        {content}
                        <ChevronDown
                          className="orbit-nav-chevron"
                          aria-hidden="true"
                          data-open={open}
                        />
                      </button>
                    )}
                    {item.href && item.children && !collapsed && (
                      <button
                        type="button"
                        className="orbit-nav-toggle"
                        aria-label={`Opciones de ${item.label}`}
                        aria-expanded={open}
                        aria-controls={childrenId}
                        onClick={toggle}
                      >
                        <ChevronDown
                          className="orbit-nav-chevron"
                          aria-hidden="true"
                          data-open={open}
                        />
                      </button>
                    )}
                  </div>
                  {item.children && (
                    <ul
                      id={childrenId}
                      className="orbit-nav-children"
                      hidden={!open}
                    >
                      {item.children.map((child) => (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            className="orbit-nav-child"
                            aria-current={
                              pathname === child.href ? "page" : undefined
                            }
                            onClick={onNavigate}
                          >
                            <child.icon aria-hidden="true" />
                            <span>{child.label}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
