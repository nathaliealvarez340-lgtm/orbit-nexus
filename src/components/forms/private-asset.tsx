"use client";
import { useState } from "react";
export function PrivateAsset({
  kind,
  value,
  onChange,
  disabled = false,
}: {
  kind: "CSF" | "INVOICE_LOGO";
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="space-y-2 text-sm">
      <label className="block">
        {kind === "CSF"
          ? "Constancia de Situación Fiscal · PDF, hasta 10 MB"
          : "Logo transparente · PNG / WEBP, hasta 2 MB"}
        <input
          className="input mt-2"
          aria-busy={busy}
          type="file"
          accept={
            kind === "CSF"
              ? ".pdf,application/pdf"
              : ".png,.webp,image/png,image/webp"
          }
          disabled={disabled || busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (
              file.size > (kind === "CSF" ? 10 : 2) * 1024 * 1024 ||
              !(kind === "CSF" ? /\.pdf$/i : /\.(png|webp)$/i).test(file.name)
            ) {
              setMessage("Formato o tamaño no permitido.");
              e.target.value = "";
              return;
            }
            setBusy(true);
            setMessage("");
            try {
              const body = new FormData();
              body.set("file", file);
              body.set("kind", kind);
              const res = await fetch("/api/private-assets", {
                  method: "POST",
                  body,
                }),
                result = await res.json();
              if (!res.ok) throw new Error(result.error);
              onChange(result.id);
              setMessage(
                "Archivo cargado. Guarda el formulario para vincularlo.",
              );
            } catch (error) {
              setMessage((error as Error).message);
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {value && (
        <a
          className="text-violet-300 underline"
          href={"/api/documents/" + value}
        >
          Ver archivo privado
        </a>
      )}
      <p role="status">{busy ? "Validando archivo…" : message}</p>
    </div>
  );
}
