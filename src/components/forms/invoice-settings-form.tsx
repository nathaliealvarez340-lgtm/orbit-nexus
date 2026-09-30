"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrivateAsset } from "./private-asset";
import { Button } from "@/components/ui/button";
export function InvoiceSettingsForm({
  initial,
  readOnly,
}: {
  initial: {
    prefix: string;
    color: string;
    nextNumber: number;
    logoDocumentId: string | null;
  } | null;
  readOnly: boolean;
}) {
  const [logo, setLogo] = useState(initial?.logoDocumentId ?? ""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <form
      className="surface space-y-6 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || readOnly) return;
        const values = Object.fromEntries(new FormData(e.currentTarget));
        if (!logo) {
          setMessage("Carga un logo transparente.");
          return;
        }
        setBusy(true);
        try {
          const response = await fetch("/api/outgoing-invoices/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...values,
              logoDocumentId: logo,
              template: "CLASSIC",
            }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          setMessage("Configuración guardada.");
          router.refresh();
        } catch (error) {
          setMessage((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || readOnly} className="space-y-5">
        <PrivateAsset
          kind="INVOICE_LOGO"
          value={logo}
          onChange={setLogo}
          disabled={busy || readOnly}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm">
            Prefijo
            <input
              className="input mt-2"
              name="prefix"
              defaultValue={initial?.prefix ?? "ORB"}
              required
              pattern="[A-Za-z0-9]{1,10}"
              maxLength={10}
            />
          </label>
          <label className="text-sm">
            Color de factura
            <input
              className="input mt-2 !h-11"
              type="color"
              name="color"
              defaultValue={initial?.color ?? "#8b5cf6"}
            />
          </label>
        </div>
        <p className="text-sm text-zinc-400">
          Siguiente secuencia:{" "}
          {String(initial?.nextNumber ?? 1).padStart(6, "0")}. Se asigna al
          guardar cada borrador y no se reutiliza.
        </p>
        <div className="rounded-xl border border-white/10 p-4">
          <h2 className="font-medium">Plantilla clásica</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Logo, emisor y receptor, conceptos, impuestos y totales. Vista
            previa en cada borrador.
          </p>
        </div>
        {!readOnly && (
          <Button type="submit" disabled={busy}>
            Guardar configuración
          </Button>
        )}
      </fieldset>
      {readOnly && (
        <p className="text-sm">
          Solo propietarios y administradores pueden cambiar esta configuración.
        </p>
      )}
      <p role="status" className="text-sm text-violet-300">
        {message}
      </p>
    </form>
  );
}
