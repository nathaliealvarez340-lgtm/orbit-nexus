import { AlertTriangle, CheckCircle2, Circle, XCircle } from "lucide-react";
import type {
  InvoiceValidationIssue,
  InvoiceValidationResult,
} from "@/types/invoice-studio";
import { sectionLabels } from "./model";

export function ValidationPanel({
  result,
  busy,
  error,
  issues = [],
  onFocusIssue,
}: {
  result?: InvoiceValidationResult;
  busy: boolean;
  error?: string;
  issues?: InvoiceValidationIssue[];
  onFocusIssue: (issue: InvoiceValidationIssue) => void;
}) {
  return (
    <section
      className="studio-card p-5"
      aria-labelledby="studio-validation-title"
    >
      <h2 id="studio-validation-title" className="font-semibold">
        Validación fiscal
      </h2>
      <p className="mt-2 text-sm text-zinc-400" role="status">
        {busy
          ? "Validando los datos actuales…"
          : error ||
            (!result
              ? "Pendiente de validar. Completa tu captura para revisar los datos."
              : result.canMarkReady
                ? "Datos listos para revisión."
                : "Revisa las observaciones antes de continuar.")}
      </p>
      <ul className="mt-5 space-y-3">
        {Object.entries(sectionLabels).map(([key, label]) => {
          const status = result?.sections[key as keyof typeof sectionLabels];
          const Icon =
            status === "OK"
              ? CheckCircle2
              : status === "ERROR"
                ? XCircle
                : status === "WARNING"
                  ? AlertTriangle
                  : Circle;
          return (
            <li
              key={key}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>{label}</span>
              <span
                className={
                  status === "OK"
                    ? "studio-success"
                    : status === "ERROR"
                      ? "studio-error"
                      : status === "WARNING"
                        ? "studio-warning"
                        : "text-zinc-400"
                }
              >
                <Icon className="mr-1 inline size-4" aria-hidden="true" />
                {status === "OK"
                  ? "Correcto"
                  : status === "ERROR"
                    ? "Revisar"
                    : status === "WARNING"
                      ? "Aviso"
                      : "Pendiente"}
              </span>
            </li>
          );
        })}
      </ul>
      {!!(result?.issues.length || issues.length) && (
        <ul className="studio-validation-issues mt-5 space-y-2 border-t border-white/10 pt-4">
          {[...(result?.issues ?? []), ...issues].map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              <button
                type="button"
                className="studio-issue"
                onClick={() => onFocusIssue(issue)}
              >
                <span
                  className={
                    issue.severity === "ERROR"
                      ? "studio-error"
                      : "studio-warning"
                  }
                >
                  {issue.severity === "ERROR" ? "Error" : "Aviso"} ·{" "}
                  {sectionLabels[issue.section]}
                  {issue.conceptIndex !== undefined
                    ? ` · Concepto ${issue.conceptIndex + 1}`
                    : ""}
                </span>
                <span className="mt-1 block text-zinc-300">
                  {issue.message}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
