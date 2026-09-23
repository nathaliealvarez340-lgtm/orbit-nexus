import Link from "next/link";
import { cookies } from "next/headers";
import { Logo } from "@/components/brand/logo";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import { parseConsent } from "@/lib/consent";
export default async function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Logo />
      <h1 className="mt-12 text-3xl font-semibold">Cookies y preferencias</h1>
      <div className="mt-7 space-y-5 text-sm leading-7 text-zinc-400">
        <p>
          Las cookies necesarias mantienen tu cuenta segura y recuerdan tu
          organización. No se desactivan con la elección de cookies opcionales.
        </p>
        <ul className="list-disc space-y-3 pl-5">
          <li>
            Better Auth: sesión de siete días, con renovación durante el uso;
            cookies HttpOnly, SameSite=Lax y Secure en producción.
          </li>
          <li>
            orbit.organization: selección de organización durante siete días. No
            concede acceso: el servidor comprueba la membresía.
          </li>
          <li>orbit.consent: guarda tus preferencias durante seis meses.</li>
        </ul>
        <p>
          Analíticas y marketing están desactivadas salvo consentimiento. No hay
          proveedores de analítica ni publicidad instalados en esta versión.
          Cualquier integración futura debe respetar cada categoría y dejar de
          cargar al retirar el consentimiento.
        </p>
        <p>
          Puedes rechazar todas las no esenciales o ajustar categorías con el
          control de preferencias de esta página. Este texto describe el
          comportamiento técnico actual; el operador debe revisar y completar la
          política antes de publicar.
        </p>
      </div>
      <div className="mt-8 flex gap-5 text-violet-300">
        <Link href="/privacy">Privacidad</Link>
        <Link href="/terms">Términos</Link>
        <Link href="/login">Acceso</Link>
      </div>
      <CookieConsent
        initial={parseConsent((await cookies()).get("orbit.consent")?.value)}
      />
    </main>
  );
}
