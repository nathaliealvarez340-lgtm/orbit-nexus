"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
export function NotificationList({
  items,
}: {
  items: {
    id: string;
    title: string;
    message: string;
    href: string;
    date: string;
    read: boolean;
  }[];
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function read(id?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setMessage("No se pudo actualizar. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <button
        className="rounded-xl border border-white/10 px-4 py-3 text-sm"
        disabled={busy || !items.some((i) => !i.read)}
        onClick={() => read()}
      >
        Marcar todas como leídas
      </button>
      {!items.length && (
        <p className="surface p-6 text-zinc-400">No hay notificaciones.</p>
      )}
      {items.map((item) => (
        <article
          key={item.id}
          className="surface flex flex-wrap items-start justify-between gap-4 p-5"
        >
          <div>
            <p className="text-xs text-violet-300">
              {item.read ? "Leída" : "No leída"} · {item.date}
            </p>
            <h2 className="mt-2 font-medium">{item.title}</h2>
            <p className="mt-2 text-sm text-zinc-400">{item.message}</p>
            <Link
              className="mt-3 inline-block text-sm text-violet-300 underline"
              href={item.href}
            >
              Ver detalle
            </Link>
          </div>
          {!item.read && (
            <button
              disabled={busy}
              className="rounded-lg border border-white/10 p-3 text-xs"
              onClick={() => read(item.id)}
            >
              Marcar como leída
            </button>
          )}
        </article>
      ))}
      <p role="status">{message}</p>
    </div>
  );
}
