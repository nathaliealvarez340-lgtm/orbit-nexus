import Link from "next/link";
import { RecoveryForm } from "@/components/forms/recovery-form";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <section className="surface p-8">
      <h1 className="text-2xl font-semibold">Nueva contraseña</h1>
      {token ? (
        <RecoveryForm token={token} />
      ) : (
        <p className="mt-4 text-sm">
          Solicita un nuevo enlace de recuperación.
        </p>
      )}
      <Link href="/login" className="mt-5 block text-sm text-violet-300">
        Iniciar sesión
      </Link>
    </section>
  );
}
