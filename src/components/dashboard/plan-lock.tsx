import Link from "next/link";
export function PlanLock() {
  return (
    <section className="surface p-8">
      <h1 className="text-2xl font-medium">Facturas · PRO / MAX</h1>
      <p className="mt-4 text-zinc-400">
        La preparación de facturas a clientes está disponible en los planes PRO
        y MAX. Tu plan actual es FREE.
      </p>
      <p className="mt-3 text-sm text-zinc-500">
        Los tickets y las facturas recibidas de tus gastos siguen disponibles.
      </p>
      <Link
        href="/dashboard/user"
        className="mt-6 inline-block text-violet-300 underline"
      >
        Ver mi plan
      </Link>
    </section>
  );
}
