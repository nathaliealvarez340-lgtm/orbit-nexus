import Link from "next/link";
import { Logo } from "@/components/brand/logo";
export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Logo />
      <h1 className="mt-12 text-3xl font-semibold">Términos del servicio</h1>
      <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
        Borrador operativo pendiente de revisión y aprobación por el responsable
        del servicio. No constituye asesoría jurídica.
      </p>
      <div className="mt-7 space-y-5 text-sm leading-7 text-zinc-400">
        <p>
          Orbit organiza tickets, gastos y documentos por organización. Cada
          usuario debe contar con autorización para incorporar y consultar la
          información de su espacio.
        </p>
        <p>
          Los datos detectados por OCR requieren revisión humana. Confirmar un
          gasto no determina por sí solo su tratamiento fiscal ni su
          deducibilidad.
        </p>
        <p>
          La facturación asistida dirige al portal del comercio. Solo el emisor
          y sus proveedores autorizados pueden emitir el comprobante
          correspondiente. Orbit no declara una factura emitida por el hecho de
          abrir un portal.
        </p>
        <p>
          Antes del lanzamiento, el operador debe completar identidad y
          contacto, alcance comercial, disponibilidad, soporte,
          responsabilidades, conservación de documentos, cancelación y ley
          aplicable con asesoría adecuada.
        </p>
      </div>
      <div className="mt-8 flex gap-5 text-violet-300">
        <Link href="/privacy">Privacidad</Link>
        <Link href="/cookies">Cookies</Link>
        <Link href="/login">Acceso</Link>
      </div>
    </main>
  );
}
