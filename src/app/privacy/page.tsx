import Link from "next/link";
import { Logo } from "@/components/brand/logo";
export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Logo />
      <h1 className="mt-12 text-3xl font-semibold">Privacidad y cookies</h1>
      <div className="mt-7 space-y-5 text-sm leading-7 text-zinc-400">
        <p>
          Orbit utiliza tus datos de cuenta para autenticarte y vincularte con
          tus organizaciones. Los tickets, gastos y datos fiscales pertenecen a
          la organización activa; los miembros autorizados de esa organización
          pueden consultarlos.
        </p>
        <p>
          Las cookies de Better Auth mantienen tu sesión durante un máximo de
          siete días, con renovación al usar la aplicación. Son HttpOnly,
          SameSite=Lax y Secure en producción. La cookie orbit.organization
          recuerda tu organización; cada petición comprueba tu membresía.
        </p>
        <p>
          La cookie orbit.consent conserva durante seis meses tu elección de
          cookies opcionales. Puedes modificarla con el botón Cookies dentro de
          la aplicación. Rechazar cookies opcionales no bloquea el inicio de
          sesión. Esta versión no carga analítica ni publicidad.
        </p>
        <p>
          Los archivos se guardan de forma privada. Si el operador configura un
          servicio OCR, los tickets se envían a ese servicio únicamente cuando
          solicitas analizarlos. Abrir un portal de facturación no envía
          automáticamente tus datos fiscales ni acredita la emisión de una
          factura.
        </p>
        <p>
          El operador del despliegue debe completar su aviso de privacidad con
          identidad del responsable, contacto, plazos de conservación y
          procedimiento para ejercer derechos antes de publicar el servicio.
        </p>
      </div>
      <Link href="/login" className="mt-8 inline-block text-violet-300">
        Volver al acceso
      </Link>
    </main>
  );
}
