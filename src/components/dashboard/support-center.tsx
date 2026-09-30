"use client";
import { useState } from "react";
import Link from "next/link";
const articles = [
  {
    category: "Tickets",
    title: "Capturar y registrar un ticket",
    text: "Usa Realizar ticket o el botón flotante. Toma una foto o sube JPG, PNG, WEBP o PDF (hasta 10 MB). Revisa los datos y confirma para crear el gasto.",
    href: "/dashboard/tickets/new",
  },
  {
    category: "Empresas",
    title: "Cambiar de empresa",
    text: "Selecciona una empresa en la barra superior. Cada empresa conserva sus propios tickets, clientes, reportes y perfil fiscal.",
    href: "/dashboard/companies",
  },
  {
    category: "Perfil fiscal",
    title: "Completar el perfil fiscal",
    text: "Guarda RFC, razón social, régimen, uso CFDI, correo y dirección; adjunta tu Constancia de Situación Fiscal en PDF.",
    href: "/dashboard/fiscal-profile",
  },
  {
    category: "Reportes",
    title: "Descargar un mes cerrado",
    text: "Al abrir Reportes se generan los meses cerrados que faltan. Descarga PDF o Excel. El archivo refleja los datos del momento de generación.",
    href: "/dashboard/reports",
  },
  {
    category: "Facturas",
    title: "Preparar una factura",
    text: "PRO y MAX permiten preparar borradores. Configura el logo y agrega un cliente. El timbrado PAC aún no está conectado.",
    href: "/dashboard/invoices/new",
  },
  {
    category: "Cuenta",
    title: "Actualizar contraseña y preferencias",
    text: "Desde Usuario puedes cambiar tu contraseña y el color de acento. El plan se muestra para la empresa activa.",
    href: "/dashboard/user",
  },
];
export function SupportCenter() {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("");
  const results = articles.filter(
    (a) =>
      (!category || a.category === category) &&
      (a.title + " " + a.text)
        .toLocaleLowerCase("es")
        .includes(query.toLocaleLowerCase("es")),
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Buscar ayuda
          <input
            type="search"
            className="input mt-2"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Categoría
          <select
            className="input mt-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todas</option>
            {articles.map((a) => (
              <option key={a.category}>{a.category}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {results.map((a) => (
          <article className="surface p-5" key={a.title}>
            <p className="text-xs text-violet-300">{a.category}</p>
            <h2 className="mt-2 font-medium">{a.title}</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-400">{a.text}</p>
            <Link className="mt-4 inline-block text-sm underline" href={a.href}>
              Abrir módulo
            </Link>
          </article>
        ))}
      </div>
      {!results.length && (
        <p role="status">No hay artículos para esta búsqueda.</p>
      )}
      <div className="surface p-5 text-sm text-zinc-400">
        Contacto directo y seguimiento de solicitudes: próximamente. Aún no hay
        un canal de soporte conectado.
      </div>
    </div>
  );
}
