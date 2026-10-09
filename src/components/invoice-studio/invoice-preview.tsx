"use client";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import type {
  CreateInvoiceDraftRequest,
  InvoiceStudioContext,
  InvoiceStudioClient,
  InvoiceValidationResult,
  InvoiceTotals,
} from "@/types/invoice-studio";
import { Button } from "@/components/ui/button";
import { catalogLabel, formatAmount, shiftDecimal } from "./model";
import { TotalsSummary } from "./totals-summary";
import { usePrivacyLayer } from "@/components/privacy/privacy-layer";

export function InvoicePreview({
  mode,
  context,
  issuer,
  receiver,
  draft,
  folio,
  totals,
  validation,
  canReady,
  busy,
  message,
  onClose,
  onReady,
}: {
  mode: "preview" | "review";
  context: InvoiceStudioContext;
  issuer: InvoiceStudioContext["issuer"];
  receiver?: InvoiceStudioClient;
  draft: CreateInvoiceDraftRequest;
  folio?: string | null;
  totals?: InvoiceTotals;
  validation?: InvoiceValidationResult;
  canReady: boolean;
  busy: boolean;
  message?: string;
  onClose: () => void;
  onReady: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    title = useId();
  const setPrivacyHost = usePrivacyLayer()?.setHost;
  useEffect(() => {
    const element = dialog.current,
      opener = document.activeElement as HTMLElement | null;
    element?.showModal();
    setPrivacyHost?.(element);
    return () => {
      element?.close();
      setPrivacyHost?.(null);
      opener?.focus();
    };
  }, [setPrivacyHost]);
  return (
    <dialog
      ref={dialog}
      className="invoice-studio studio-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="studio-preview-heading">
        <div>
          <p className="studio-eyebrow">
            {mode === "review" ? "Revisión final" : "Vista previa"}
          </p>
          <h2 id={title} className="mt-2 text-xl font-semibold">
            {folio ?? "Factura en preparación"}
          </h2>
          <p className="mt-2 text-sm text-amber-200">
            Documento aún no timbrado
          </p>
        </div>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Cerrar vista previa"
          disabled={busy}
          onClick={onClose}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="studio-preview-body">
        <div className="studio-field-grid">
          {[
            { title: "Emisor", identity: issuer },
            { title: "Receptor", identity: receiver },
          ].map(({ title: label, identity }) => (
            <section className="studio-card p-5" key={label}>
              <h3 className="text-sm text-zinc-400">{label}</h3>
              <p className="mt-2 font-medium">
                {identity?.legalName || "Pendiente"}
              </p>
              <p className="mt-1 font-mono text-sm">
                {identity?.rfc || "RFC pendiente"}
              </p>
              <p className="mt-3 text-sm text-zinc-400">
                {catalogLabel(
                  context.catalogs.fiscalRegimes,
                  identity?.fiscalRegime,
                )}
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                Código postal: {identity?.postalCode || "Pendiente"}
              </p>
            </section>
          ))}
        </div>
        <dl className="studio-identity studio-preview-details">
          {[
            ["Fecha", draft.invoiceDate],
            [
              "Tipo",
              catalogLabel(context.catalogs.documentTypes, draft.documentType),
            ],
            [
              "Uso CFDI",
              catalogLabel(context.catalogs.cfdiUses, draft.cfdiUse),
            ],
            [
              "Método",
              catalogLabel(
                context.catalogs.paymentMethods,
                draft.paymentMethod,
              ),
            ],
            [
              "Forma de pago",
              catalogLabel(context.catalogs.paymentForms, draft.paymentForm),
            ],
            ["Moneda", draft.currency],
            ["Tipo de cambio", draft.exchangeRate ?? "No capturado"],
            [
              "Exportación",
              catalogLabel(context.catalogs.exportCodes, draft.exportCode),
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || "Pendiente"}</dd>
            </div>
          ))}
        </dl>
        <section
          aria-label="Conceptos de la vista previa"
          className="space-y-3"
        >
          {draft.concepts.map((line, index) => (
            <article key={index} className="studio-card p-4">
              <div className="flex flex-wrap justify-between gap-3">
                <h3 className="font-medium">
                  {index + 1}. {line.description || "Descripción pendiente"}
                </h3>
                <span className="font-mono text-sm">
                  {formatAmount(totals?.lines[index]?.total, draft.currency)}
                </span>
              </div>
              <dl className="studio-identity mt-3">
                {[
                  [
                    "Clave SAT / unidad",
                    `${line.productCode || "—"} / ${line.unitCode || "—"}`,
                  ],
                  ["Cantidad", line.quantity],
                  [
                    "Precio unitario",
                    formatAmount(line.unitPrice, draft.currency),
                  ],
                  [
                    "Descuento",
                    formatAmount(line.discount || "0", draft.currency),
                  ],
                  [
                    "Objeto de impuesto",
                    catalogLabel(context.catalogs.taxObjects, line.taxObject),
                  ],
                  [
                    "IVA",
                    line.vatFactor === "EXENTO"
                      ? "Exento"
                      : line.vatRate
                        ? `${shiftDecimal(line.vatRate, 2)}%`
                        : "Pendiente",
                  ],
                  [
                    "Retención IVA / ISR",
                    `${shiftDecimal(line.withholdingVatRate || "0", 2)}% / ${shiftDecimal(line.withholdingIsrRate || "0", 2)}%`,
                  ],
                  [
                    "Traslados",
                    formatAmount(
                      totals?.lines[index]?.transferredTaxes,
                      draft.currency,
                    ),
                  ],
                  [
                    "Retenciones",
                    formatAmount(
                      totals?.lines[index]?.withheldTaxes,
                      draft.currency,
                    ),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "Pendiente"}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </section>
        <div className="mt-5">
          <TotalsSummary totals={totals} currency={draft.currency} />
        </div>
        {mode === "review" && (
          <section
            className="studio-card mt-5 p-5"
            aria-label="Resultado de revisión fiscal"
          >
            <h3 className="font-medium">Revisión fiscal</h3>
            <p className="mt-2 text-sm text-zinc-400">
              {validation
                ? validation.canMarkReady
                  ? "La validación permite marcar este borrador como listo."
                  : "Hay requisitos pendientes antes de marcar el borrador como listo."
                : "La validación del servidor está pendiente."}
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {validation?.issues.map((issue, index) => (
                <li
                  key={`${issue.code}-${index}`}
                  className={
                    issue.severity === "ERROR"
                      ? "studio-error"
                      : "studio-warning"
                  }
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="studio-preview-footer">
        <p className="text-sm text-zinc-400">
          Timbrado pendiente de configuración. Marcar como listo conserva el
          documento como borrador sin emitir.
        </p>
        {message && (
          <p role="status" className="text-sm text-zinc-300">
            {message}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Seguir editando
          </Button>
          {mode === "review" && (
            <Button disabled={!canReady || busy} onClick={onReady}>
              {busy ? "Revisando…" : "Marcar borrador como listo"}
            </Button>
          )}
        </div>
        {mode === "review" && !canReady && (
          <p className="studio-help">
            Guarda tus cambios y completa la validación para marcar el borrador
            como listo.
          </p>
        )}
      </div>
    </dialog>
  );
}
