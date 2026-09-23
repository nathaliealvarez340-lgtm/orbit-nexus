import Link from "next/link";
import { RecoveryForm } from "@/components/forms/recovery-form";
export default function Page() {
  return (
    <section className="surface p-8">
      <h1 className="text-2xl font-semibold">Recupera tu acceso</h1>
      <p className="mt-3 text-sm text-zinc-400">
        Te enviaremos un enlace de un solo uso.
      </p>
      <RecoveryForm />
      <Link href="/login" className="mt-5 block text-sm text-violet-300">
        Volver al inicio de sesión
      </Link>
    </section>
  );
}
