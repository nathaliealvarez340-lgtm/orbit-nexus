import Link from "next/link";
import { AuthForm } from "@/components/forms/auth-form";

export default function LoginPage() {
  return <section className="surface p-7 sm:p-9"><p className="text-xs font-semibold uppercase tracking-[.18em] text-violet-400">Bienvenido de vuelta</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">Inicia sesión en Orbit</h1><p className="mt-2 text-sm text-zinc-500">Continúa con tu operación fiscal.</p><AuthForm mode="login" /><p className="mt-6 text-center text-sm text-zinc-500">¿Aún no tienes cuenta? <Link href="/register" className="text-white">Crear cuenta</Link></p></section>;
}
