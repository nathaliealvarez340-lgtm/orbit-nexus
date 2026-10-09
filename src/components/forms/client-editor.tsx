"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ClientFiscalForm } from "@/components/fiscal/client-fiscal-form";
import type {
  InvoiceFiscalCatalogs,
  InvoiceStudioClient,
} from "@/types/invoice-studio";
type ClientData = InvoiceStudioClient & {
  email: string;
  archivedAt: string | null;
  [key: string]: unknown;
};
export function ClientEditor({
  clients,
  catalogs,
}: {
  clients: ClientData[];
  catalogs: Pick<InvoiceFiscalCatalogs, "paymentForms">;
}) {
  const [editing, setEditing] = useState<ClientData | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <div className="fiscal-ui space-y-6">
      <Button
        onClick={(event) => {
          opener.current = event.currentTarget;
          setEditing(null);
          setOpen(true);
          setMessage("");
          setFailed(false);
        }}
      >
        Nuevo cliente
      </Button>
      {open && (
        <ClientFiscalForm
          key={editing?.id ?? "new"}
          initial={editing}
          catalogs={catalogs}
          onCancel={close}
          onSaved={() => {
            close();
            setFailed(false);
            setMessage("✓ Información guardada correctamente");
            router.refresh();
          }}
        />
      )}
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={failed ? "fiscal-error" : "text-sm text-violet-300"}
        >
          {message}
        </p>
      )}
      <div
        className="surface overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Tabla de clientes"
      >
        <table className="w-full">
          <thead>
            <tr>
              {["Nombre", "RFC", "Correo", "Estado", "Acciones"].map(
                (heading) => (
                  <th key={heading}>{heading}</th>
                ),
              )}
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
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          setEditing(client);
                          setOpen(true);
                          setMessage("");
                          setFailed(false);
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
                          setMessage("");
                          setFailed(false);
                          try {
                            const response = await fetch(
                              "/api/clients/" + encodeURIComponent(client.id),
                              { method: "DELETE" },
                            );
                            if (!response.ok) throw new Error();
                            setMessage(
                              "Cliente archivado; historial conservado.",
                            );
                            router.refresh();
                          } catch {
                            setFailed(true);
                            setMessage("⚠ No se pudo archivar.");
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
