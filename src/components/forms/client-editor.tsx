"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addressFields, cfdiUses, paymentForms } from "@/lib/fiscal-catalogs";
type ClientData = {
  id: string;
  legalName: string;
  rfc: string;
  email: string;
  archivedAt: string | null;
  [key: string]: unknown;
};
const fields = [
  ["rfc", "RFC"],
  ["legalName", "Nombre / razón social"],
  ["internalNumber", "Número interno (opcional)"],
  ["foreignTaxId", "Registro fiscal extranjero (opcional)"],
  ["fiscalRegime", "Régimen fiscal (clave de tres dígitos)"],
  ["phone", "Teléfono (opcional)"],
  ["email", "Correo"],
  ["postalCode", "Código postal"],
  ...addressFields,
  ["reference", "Referencia (opcional)"],
  ["notes", "Notas (opcional)"],
];
export function ClientEditor({ clients }: { clients: ClientData[] }) {
  const [editing, setEditing] = useState<ClientData | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <div className="space-y-6">
      <Button
        onClick={() => {
          setEditing(null);
          setOpen(true);
          setMessage("");
        }}
      >
        Nuevo cliente
      </Button>
      {open && (
        <form
          key={editing?.id ?? "new"}
          className="surface p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const values = Object.fromEntries(new FormData(e.currentTarget));
            setBusy(true);
            setMessage("");
            try {
              const response = await fetch(
                  "/api/clients" + (editing ? "/" + editing.id : ""),
                  {
                    method: editing ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      ...values,
                      additionalEmails: String(values.additionalEmails || "")
                        .split(/[;,]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }),
                  },
                ),
                result = await response.json();
              if (!response.ok)
                throw new Error(
                  result.fields
                    ? Object.values(result.fields).flat().join(" ")
                    : result.error,
                );
              setOpen(false);
              setMessage("Cliente guardado.");
              router.refresh();
            } catch (error) {
              setMessage((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="mb-5 font-medium">
            {editing ? "Editar cliente" : "Datos del cliente"}
          </h2>
          <fieldset disabled={busy}>
            <div className="grid gap-4 md:grid-cols-2">
              {fields.map(([key, label]) => (
                <label key={key} className="text-sm text-zinc-400">
                  {label}
                  <input
                    className="input mt-2"
                    name={key}
                    defaultValue={String(
                      editing?.[key] ?? (key === "country" ? "MEX" : ""),
                    )}
                    required={[
                      "rfc",
                      "legalName",
                      "fiscalRegime",
                      "email",
                      "postalCode",
                      "country",
                    ].includes(key)}
                    type={key === "email" ? "email" : "text"}
                    maxLength={key === "notes" ? 2000 : 254}
                  />
                </label>
              ))}
              <label className="text-sm text-zinc-400">
                Tipo de persona
                <select
                  name="personType"
                  className="input mt-2"
                  defaultValue={String(editing?.personType ?? "COMPANY")}
                >
                  <option value="COMPANY">Persona moral</option>
                  <option value="INDIVIDUAL">Persona física</option>
                </select>
              </label>
              <label className="text-sm text-zinc-400">
                Uso CFDI
                <select
                  name="cfdiUse"
                  className="input mt-2"
                  defaultValue={String(editing?.cfdiUse ?? "G03")}
                >
                  {cfdiUses.map(([code, label]) => (
                    <option key={code} value={code}>
                      {code} · {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-zinc-400">
                Forma de pago predeterminada
                <select
                  name="defaultPaymentForm"
                  className="input mt-2"
                  defaultValue={String(editing?.defaultPaymentForm ?? "99")}
                >
                  {paymentForms.map(([code, label]) => (
                    <option key={code} value={code}>
                      {code} · {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-zinc-400">
                Correos adicionales (separados por coma)
                <input
                  name="additionalEmails"
                  className="input mt-2"
                  defaultValue={
                    Array.isArray(editing?.additionalEmails)
                      ? editing.additionalEmails.join(", ")
                      : ""
                  }
                />
              </label>
            </div>
            <div className="mt-5 flex gap-3">
              <Button type="submit">Guardar cliente</Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      <p role="status" className="text-sm text-violet-300">
        {message}
      </p>
      <div
        className="surface overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Tabla de clientes"
      >
        <table className="w-full">
          <thead>
            <tr>
              {["Nombre", "RFC", "Correo", "Estado", "Acciones"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td>{client.legalName}</td>
                <td className="whitespace-nowrap">{client.rfc}</td>
                <td>{client.email}</td>
                <td>{client.archivedAt ? "Archivado" : "Activo"}</td>
                <td className="min-w-44">
                  {!client.archivedAt && (
                    <div className="flex gap-2">
                      <button
                        className="p-2 text-violet-300 underline"
                        onClick={() => {
                          setEditing(client);
                          setOpen(true);
                          setMessage("");
                        }}
                      >
                        Editar
                      </button>
                      <button
                        disabled={busy}
                        className="p-2 text-zinc-400 underline"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              "¿Archivar este cliente? Su historial se conservará.",
                            )
                          )
                            return;
                          setBusy(true);
                          try {
                            const response = await fetch(
                              "/api/clients/" + client.id,
                              { method: "DELETE" },
                            );
                            if (!response.ok) throw new Error();
                            setMessage(
                              "Cliente archivado; historial conservado.",
                            );
                            router.refresh();
                          } catch {
                            setMessage("No se pudo archivar.");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Archivar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!clients.length && (
          <p className="p-6 text-sm text-zinc-400">
            No hay clientes para esta búsqueda.
          </p>
        )}
      </div>
    </div>
  );
}
