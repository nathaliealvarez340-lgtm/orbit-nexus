import Link from "next/link";
import { cookies } from "next/headers";
import { Logo } from "@/components/brand/logo";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import { parseConsent } from "@/lib/consent";
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const consent = parseConsent((await cookies()).get("orbit.consent")?.value);
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#08080a] px-5 py-12 text-white">
      <div className="orb-grid absolute inset-0 opacity-40" />
      <div className="absolute left-6 top-6">
        <Logo />
      </div>
      <div className="relative w-full max-w-md">
        {children}
        <p className="mt-6 text-center text-xs text-zinc-600">
          Al continuar aceptas los{" "}
          <Link href="/terms" className="text-zinc-400">
            términos
          </Link>{" "}
          y el{" "}
          <Link href="/privacy" className="text-zinc-400">
            aviso de privacidad
          </Link>
          .
        </p>
      </div>
      <CookieConsent initial={consent} />
    </main>
  );
}
