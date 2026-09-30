"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cfdiUses, paymentForms } from "@/lib/fiscal-catalogs";
import { Button } from "@/components/ui/button";
export function OutgoingInvoiceForm({
  clients,
  ready,
}: {
  clients: {
    id: string;
    legalName: string;
    rfc: string;
    cfdiUse: string;
    defaultPaymentForm: string;
  }[];
  ready: boolean;
}) {
  const [lines, setLines] = useState([0]),
    nextLine = useRef(1),
    lock = useRef(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id ?? ""),
    client = clients.find((c) => c.id === clientId),
    router = useRouter();
  return (
    <form
      className="surface space-y-6 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current || !ready) return;
        lock.current = true;
        setBusy(true);
        setMessage("");
        const form = new FormData(e.currentTarget),
          fields = Object.fromEntries(form);
        try {
          const response = await fetch("/api/outgoing-invoices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...fields,
                concepts: lines.map((i) =>
                  Object.fromEntries(
                    [
                      "description",
                      "productCode",
                      "unitCode",
                      "quantity",
                      "unitPrice",
                      "taxRate",
                    ].map((key) => [key, form.get(key + "-" + i)]),
                  ),
                ),
              }),
            }),
            result = await response.json();
          if (!response.ok)
            throw new Error(
              result.fields
                ? Object.values(result.fields).flat().join(" ")
                : result.error,
            );
          router.push("/dashboard/invoices/drafts/" + result.id);
          router.refresh();
        } catch (error) {
          setMessage((error as Error).message);
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={!ready || busy} className="space-y-6">
        <div className="grid gap-5 md:grid-cols-2">
          <label className="text-sm">
            Cliente receptor
            <select
              name="clientId"
              className="input mt-2"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              {!clients.length && (
                <option value="">Agrega un cliente primero</option>
              )}
              {clients.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.legalName} · {c.rfc}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Fecha
            <input
              name="invoiceDate"
              type="date"
              className="input mt-2"
              required
              defaultValue={new Date().toLocaleDateString("en-CA", {
                timeZone: "America/Mexico_City",
              })}
            />
          </label>
          <label className="text-sm">
            Tipo de comprobante
            <select name="documentType" className="input mt-2">
              <option value="I">I · Ingreso</option>
              <option value="E">E · Egreso</option>
            </select>
          </label>
          <label className="text-sm">
            Moneda
            <select name="currency" className="input mt-2">
              {["MXN", "USD", "EUR"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Uso CFDI
            <select
              key={"use-" + clientId}
              name="cfdiUse"
              className="input mt-2"
              defaultValue={client?.cfdiUse ?? "G03"}
            >
              {cfdiUses.map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Forma de pago
            <select
              key={"pay-" + clientId}
              name="paymentForm"
              className="input mt-2"
              defaultValue={client?.defaultPaymentForm ?? "99"}
            >
              {paymentForms.map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Método de pago
            <select name="paymentMethod" className="input mt-2">
              <option value="PUE">PUE · Pago en una sola exhibición</option>
              <option value="PPD">
                PPD · Pago en parcialidades o diferido
              </option>
            </select>
          </label>
        </div>
        <h2 className="font-medium">Conceptos</h2>
        {lines.map((id, index) => (
          <fieldset key={id} className="rounded-xl border border-white/10 p-4">
            <legend className="px-2 text-sm">Concepto {index + 1}</legend>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["description", "Descripción", ""],
                ["productCode", "Clave de producto / servicio", "01010101"],
                ["unitCode", "Clave de unidad", "ACT"],
                ["quantity", "Cantidad", "1"],
                ["unitPrice", "Precio unitario", ""],
              ].map(([key, label, value]) => (
                <label key={key} className="text-xs text-zinc-400">
                  {label}
                  <input
                    required
                    className="input mt-2"
                    name={key + "-" + id}
                    defaultValue={value}
                    maxLength={key === "description" ? 500 : 20}
                    inputMode={
                      ["quantity", "unitPrice"].includes(key)
                        ? "decimal"
                        : "text"
                    }
                  />
                </label>
              ))}
              <label className="text-xs text-zinc-400">
                IVA
                <select name={"taxRate-" + id} className="input mt-2">
                  <option value="0.16">16%</option>
                  <option value="0.08">8%</option>
                  <option value="0">0%</option>
                </select>
              </label>
            </div>
            {lines.length > 1 && (
              <button
                type="button"
                className="mt-3 p-2 text-sm text-red-300"
                onClick={() => setLines(lines.filter((n) => n !== id))}
              >
                Quitar concepto {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        <Button
          variant="secondary"
          disabled={lines.length >= 100}
          onClick={() => setLines([...lines, nextLine.current++])}
        >
          Agregar concepto
        </Button>
        <p className="text-sm text-zinc-400">
          Timbrado pendiente de integración PAC. Se guardará un borrador con
          importes calculados en servidor; podrás revisar la vista previa. No es
          un CFDI emitido.
        </p>
        <Button type="submit" disabled={busy || !clients.length}>
          Guardar y ver borrador
        </Button>
      </fieldset>
      <p role="status" className="text-sm text-violet-300">
        {message}
      </p>
    </form>
  );
}
