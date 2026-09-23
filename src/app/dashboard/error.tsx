"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="surface p-8">
      <h1 className="text-xl font-semibold">
        No pudimos cargar esta información
      </h1>
      <p className="mt-3 text-sm text-zinc-400">
        Intenta nuevamente. Si el problema continúa, revisa la configuración del
        servicio.
      </p>
      <button
        onClick={reset}
        className="mt-5 rounded-xl bg-white px-4 py-2 text-sm text-black"
      >
        Reintentar
      </button>
    </section>
  );
}
