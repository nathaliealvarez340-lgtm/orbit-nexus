"use client";

import { motion } from "framer-motion";
import gsap from "gsap";
import { ArrowRight, Check, FileCheck2, Fingerprint, Gauge, ReceiptText, ScanLine, ShieldCheck, Sparkles, Stamp } from "lucide-react";
import { useEffect, useRef } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";

const nav = ["Producto", "Cómo funciona", "Empresas compatibles", "Timbrado", "Precios"];
const features = [
  { icon: ScanLine, title: "OCR preparado", copy: "Arquitectura mult proveedor para detectar comercio, folio, fecha y total." },
  { icon: ReceiptText, title: "Tickets organizados", copy: "Cada comprobante sigue un flujo visible desde captura hasta factura." },
  { icon: FileCheck2, title: "CFDI centralizados", copy: "XML, PDF y datos fiscales en un espacio operativo confiable." },
  { icon: Stamp, title: "Timbrado listo", copy: "Diseñado para conectar un PAC cuando la operación esté preparada." },
  { icon: Gauge, title: "Control financiero", copy: "Indicadores claros para conocer gasto, facturación y pendientes." },
  { icon: ShieldCheck, title: "Seguridad por diseño", copy: "Validación, trazabilidad y confirmación antes de guardar datos fiscales." },
];
const steps = [
  ["01", "Captura", "Sube una foto o PDF de tu ticket."],
  ["02", "Orbit analiza", "Detectamos empresa y datos clave."],
  ["03", "Tú validas", "Confirma la información antes de facturar."],
  ["04", "Todo listo", "XML y PDF quedan organizados."],
];

export function Landing() {
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!glow.current) return;
    gsap.to(glow.current, { rotate: 360, duration: 28, repeat: -1, ease: "none" });
  }, []);

  return (
    <main className="overflow-hidden bg-[#070709] text-white">
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/[.06] bg-[#070709]/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-5">
          <Logo />
          <div className="mx-auto hidden gap-7 text-sm text-zinc-500 lg:flex">{nav.map((item) => <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`} className="hover:text-white">{item}</a>)}</div>
          <div className="ml-auto flex gap-2"><Button href="/login" variant="ghost">Login</Button><Button href="/register" variant="secondary">Register</Button></div>
        </div>
      </nav>

      <section className="relative mx-auto flex min-h-[820px] max-w-7xl flex-col items-center justify-center px-5 pb-20 pt-32 text-center">
        <div ref={glow} className="pointer-events-none absolute top-0 size-[700px] rounded-full opacity-50 blur-3xl [background:conic-gradient(from_90deg,transparent,#7c3aed30,transparent,#34d39918,transparent)]" />
        <motion.div initial={{ opacity: 0, transform: "translateY(10px)" }} animate={{ opacity: 1, transform: "translateY(0)" }} transition={{ duration: .5 }} className="relative">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/[.08] px-3 py-1.5 text-xs font-medium text-violet-300"><Sparkles className="size-3" /> Automatización fiscal inteligente</span>
          <h1 className="mx-auto mt-8 max-w-4xl text-balance text-5xl font-semibold leading-[1.02] tracking-[-.065em] sm:text-7xl lg:text-[88px]">La nueva forma de convertir <span className="text-gradient">tickets en facturas.</span></h1>
          <p className="mx-auto mt-7 max-w-2xl text-balance text-lg leading-8 text-zinc-400">Captura tickets, organiza gastos, administra CFDI y automatiza tu operación fiscal desde un solo lugar.</p>
          <div className="mt-9 flex justify-center gap-3"><Button href="/register" className="h-12 px-6">Crear cuenta <ArrowRight className="size-4" /></Button><Button href="/login" variant="secondary" className="h-12 px-6">Iniciar sesión</Button></div>
        </motion.div>
        <motion.div initial={{ opacity: 0, transform: "translateY(30px) scale(.98)" }} animate={{ opacity: 1, transform: "translateY(0) scale(1)" }} transition={{ delay: .2, duration: .7 }} className="dashboard-preview relative mt-20 w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0d0d11] p-3 shadow-2xl shadow-violet-950/30">
          <div className="rounded-[20px] border border-white/[.06] bg-[#0a0a0d] p-5 text-left">
            <div className="flex items-center justify-between border-b border-white/[.06] pb-4"><Logo /><span className="rounded-lg bg-violet-500/10 px-3 py-1 text-xs text-violet-300">Orbit Engine activo</span></div>
            <div className="grid gap-4 pt-5 md:grid-cols-3">
              {["Total facturado|$142,890|+18.2%", "Tickets procesados|1,284|98% precisión", "Tiempo recuperado|42 h|este mes"].map((item) => { const [a,b,c] = item.split("|"); return <div key={a} className="rounded-2xl border border-white/[.06] bg-white/[.025] p-5"><p className="text-xs text-zinc-500">{a}</p><p className="mt-4 font-mono text-2xl">{b}</p><p className="mt-1 text-xs text-emerald-400">{c}</p></div>; })}
            </div>
          </div>
        </motion.div>
      </section>

      <section id="producto" className="border-y border-white/[.06] bg-white/[.015] px-5 py-28">
        <SectionHeading eyebrow="Un solo sistema" title="Tu operación fiscal, finalmente conectada." copy="ORBIT NEXUS transforma comprobantes dispersos en un flujo claro, verificable y listo para crecer." />
        <div className="mx-auto mt-14 grid max-w-6xl gap-4 md:grid-cols-2 lg:grid-cols-3">{features.map(({ icon: Icon, title, copy }, index) => <motion.article key={title} initial={{ opacity: 0, transform: "translateY(12px)" }} whileInView={{ opacity: 1, transform: "translateY(0)" }} viewport={{ once: true }} transition={{ delay: index * .04 }} className="surface p-6"><span className="grid size-10 place-items-center rounded-xl bg-violet-500/10 text-violet-400"><Icon className="size-5" /></span><h3 className="mt-8 font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-zinc-500">{copy}</p></motion.article>)}</div>
      </section>

      <section id="cómo-funciona" className="mx-auto max-w-6xl px-5 py-28">
        <SectionHeading eyebrow="Del ticket al XML" title="Cuatro pasos. Cero captura repetitiva." copy="Una experiencia guiada que mantiene al usuario en control mientras Orbit prepara cada factura." />
        <div className="mt-16 grid gap-4 md:grid-cols-4">{steps.map(([number,title,copy]) => <div key={number} className="relative rounded-2xl border border-white/[.07] p-6"><span className="font-mono text-xs text-violet-400">{number}</span><h3 className="mt-14 font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-zinc-500">{copy}</p></div>)}</div>
      </section>

      <section id="timbrado" className="px-5 py-28"><div className="mx-auto grid max-w-6xl gap-12 rounded-[32px] border border-white/[.08] bg-gradient-to-br from-violet-500/[.12] to-transparent p-8 md:grid-cols-2 md:p-14"><div><span className="text-xs font-semibold uppercase tracking-[.2em] text-violet-400">Preparado para crecer</span><h2 className="mt-5 text-4xl font-semibold tracking-[-.05em]">De captura asistida a automatización completa.</h2><p className="mt-5 leading-7 text-zinc-400">La arquitectura desacopla OCR, reglas por empresa y proveedor de timbrado para integrar servicios reales sin reconstruir el producto.</p><Button href="/register" className="mt-8">Comenzar ahora <ArrowRight className="size-4" /></Button></div><div className="space-y-3">{["Datos fiscales validados", "Reglas configurables por empresa", "Proveedor OCR intercambiable", "Integración PAC desacoplada", "Actividad auditable"].map((item) => <div key={item} className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-black/20 p-4 text-sm text-zinc-300"><Check className="size-4 text-emerald-400" />{item}</div>)}</div></div></section>

      <section id="precios" className="mx-auto max-w-4xl px-5 py-28 text-center"><Fingerprint className="mx-auto size-7 text-violet-400" /><h2 className="mt-6 text-4xl font-semibold tracking-[-.05em]">Tu información fiscal merece un sistema serio.</h2><p className="mx-auto mt-4 max-w-xl text-zinc-500">Empieza con la base diseñada para acompañar tu operación desde el primer ticket.</p><Button href="/register" className="mt-8 h-12 px-6">Crear cuenta gratis</Button></section>
      <footer className="border-t border-white/[.06] px-5 py-8"><div className="mx-auto flex max-w-7xl items-center justify-between"><Logo /><p className="text-xs text-zinc-600">© 2026 ORBIT NEXUS · Fiscal intelligence infrastructure</p></div></footer>
    </main>
  );
}
