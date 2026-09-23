import Link from "next/link";
import { AuthForm } from "@/components/forms/auth-form";

export default function RegisterPage() {
  return (
    <section className="surface p-7 sm:p-9">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-violet-400">
        Primer paso
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">
        Construye una operación más clara
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Crea tu espacio fiscal en menos de un minuto.
      </p>
      <AuthForm mode="register" />
      <p className="mt-6 text-center text-sm text-zinc-500">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-white">
          Iniciar sesión
        </Link>
      </p>
    </section>
  );
}
