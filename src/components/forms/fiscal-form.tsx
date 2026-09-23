"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
const fields = [
  ["rfc", "RFC", "text"],
  ["legalName", "Razón social", "text"],
  ["fiscalRegime", "Régimen fiscal (clave de 3 dígitos)", "text"],
  ["postalCode", "Código postal fiscal", "text"],
  ["cfdiUse", "Uso CFDI predeterminado (clave)", "text"],
  ["email", "Correo fiscal", "email"],
];
export function FiscalForm({
  initial,
  documentId,
  readOnly = false,
}: {
  initial: Record<string, string>;
  documentId?: string;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const router = useRouter();
  return (
    <form
      className="surface p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current || readOnly) return;
        lock.current = true;
        setBusy(true);
        setMessage("");
        const values = Object.fromEntries(new FormData(e.currentTarget));
        try {
          const res = await fetch("/api/fiscal-profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...values,
              confirmed: values.confirmed === "on",
              documentId,
            }),
          });
          const data = await res.json();
          if (!res.ok)
            throw new Error(
              data.fields
                ? Object.values(data.fields).flat().join(" ")
                : data.error,
            );
          setMessage("Perfil fiscal confirmado y guardado.");
          router.refresh();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={readOnly || busy}>
        <div className="grid gap-5 md:grid-cols-2">
          {fields.map(([name, label, type]) => (
            <label key={name} className="text-sm text-zinc-400">
              {label}
              <input
                name={name}
                type={type}
                className="input mt-2"
                defaultValue={initial[name] || ""}
                required
                maxLength={
                  name === "legalName" ? 200 : name === "email" ? 254 : 20
                }
              />
            </label>
          ))}
          <label className="text-sm text-zinc-400">
            Tipo de persona
            <select
              name="personType"
              className="input mt-2"
              defaultValue={initial.personType || "COMPANY"}
            >
              <option value="INDIVIDUAL">Persona física</option>
              <option value="COMPANY">Persona moral</option>
            </select>
          </label>
        </div>
        <label className="mt-6 flex items-start gap-3 text-sm text-zinc-400">
          <input
            type="checkbox"
            name="confirmed"
            required
            className="mt-1 accent-violet-500"
          />
          Revisé y confirmo los datos fiscales de esta organización.
        </label>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {!readOnly && (
            <Button type="submit" disabled={busy}>
              {busy ? "Guardando…" : "Confirmar y guardar perfil"}
            </Button>
          )}
        </div>
      </fieldset>
      {readOnly && (
        <p className="mt-5 text-sm text-zinc-500">
          Solo propietarios y administradores pueden actualizar el perfil.
        </p>
      )}
      {message && (
        <p role="status" className="mt-4 text-sm text-violet-300">
          {message}
        </p>
      )}
    </form>
  );
}
