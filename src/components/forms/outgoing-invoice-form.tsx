"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Eye, FileCheck2, Save, ShieldCheck } from "lucide-react";
import type {
  CreateInvoiceDraftRequest,
  CreateInvoiceDraftResponse,
  InvoiceStudioContext,
  InvoiceValidationIssue,
} from "@/types/invoice-studio";
import { Button } from "@/components/ui/button";
import {
  DocumentSections,
  type UpdateDraftField,
} from "@/components/invoice-studio/document-sections";
import { ConceptEditor } from "@/components/invoice-studio/concept-editor";
import { TotalsSummary } from "@/components/invoice-studio/totals-summary";
import { ValidationPanel } from "@/components/invoice-studio/validation-panel";
import { InvoicePreview } from "@/components/invoice-studio/invoice-preview";
import {
  draftRequest,
  issueTarget,
  newDraft,
  type DraftDetail,
  type Evaluation,
} from "@/components/invoice-studio/model";
import {
  readContext,
  readDetail,
  readEvaluation,
  readSaved,
  StudioRequestError,
  studioRequest,
} from "@/components/invoice-studio/transport";
import "@/components/invoice-studio/invoice-studio.css";

export function OutgoingInvoiceForm({
  draftId,
  initialView,
}: {
  draftId?: string;
  initialView?: "preview";
}) {
  const [context, setContext] = useState<InvoiceStudioContext>();
  const [draft, setDraft] = useState<CreateInvoiceDraftRequest>();
  const [snapshot, setSnapshot] = useState<DraftDetail>();
  const [saved, setSaved] = useState<CreateInvoiceDraftResponse>();
  const [keys, setKeys] = useState<string[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation>();
  const [issues, setIssues] = useState<InvoiceValidationIssue[]>([]);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState<"save" | "ready" | null>(null);
  const [validating, setValidating] = useState(false),
    [validationError, setValidationError] = useState("");
  const [loadError, setLoadError] = useState(""),
    [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [reload, setReload] = useState(0),
    [view, setView] = useState<"preview" | "review" | null>(null);
  const revision = useRef(0),
    locked = useRef(false),
    evaluationRequest = useRef<AbortController | null>(null);
  const idempotencyKey = useRef<string | null>(null),
    form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      studioRequest("/api/outgoing-invoices/context", {
        signal: controller.signal,
      }).then(readContext),
      draftId
        ? studioRequest(
            "/api/outgoing-invoices/" + encodeURIComponent(draftId),
            { signal: controller.signal },
          ).then(readDetail)
        : undefined,
    ])
      .then(([data, detail]) => {
        if (controller.signal.aborted) return;
        const initial = detail ? draftRequest(detail) : newDraft(data);
        setContext(data);
        setDraft(initial);
        setKeys(initial.concepts.map((_, i) => `loaded-${i}`));
        setSnapshot(detail);
        setSaved(detail);
        setEvaluation(detail);
        setLoadError("");
        setDirty(false);
        setConflict(false);
        setUncertain(false);
        setIssues([]);
        setMessage("");
        if (initialView) setView(initialView);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setLoadError(error.message);
      });
    return () => {
      controller.abort();
      evaluationRequest.current?.abort();
    };
  }, [draftId, reload, initialView]);
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uncertain]);

  const validate = useCallback(async () => {
    if (!draft || !context || locked.current) return;
    evaluationRequest.current?.abort();
    const controller = new AbortController(),
      version = revision.current;
    evaluationRequest.current = controller;
    setValidating(true);
    setValidationError("");
    try {
      const result = readEvaluation(
        await studioRequest("/api/outgoing-invoices/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
          signal: controller.signal,
        }),
      );
      if (!controller.signal.aborted && version === revision.current) {
        setEvaluation(result);
        setIssues([]);
      }
    } catch (error) {
      if (!controller.signal.aborted && version === revision.current) {
        setValidationError((error as Error).message);
        if (error instanceof StudioRequestError) setIssues(error.issues ?? []);
      }
    } finally {
      if (!controller.signal.aborted && version === revision.current)
        setValidating(false);
    }
  }, [draft, context]);
  useEffect(() => {
    if (!dirty || !draft?.clientId || busy || uncertain || conflict) return;
    const timer = setTimeout(() => {
      void validate();
    }, 800);
    return () => {
      clearTimeout(timer);
      evaluationRequest.current?.abort();
    };
  }, [dirty, draft, validate, busy, uncertain, conflict]);

  function invalidate() {
    idempotencyKey.current = null;
    revision.current++;
    evaluationRequest.current?.abort();
    setEvaluation(undefined);
    setIssues([]);
    setValidationError("");
    setValidating(false);
    setDirty(true);
    setMessage("");
  }
  const change: UpdateDraftField = (field, value) => {
    if (locked.current || uncertain || conflict) return;
    invalidate();
    setDraft((current) =>
      current
        ? {
            ...current,
            [field]: value,
            ...(field === "currency" && value === "MXN"
              ? { exchangeRate: undefined }
              : {}),
          }
        : current,
    );
  };
  function focusIssue(issue: InvoiceValidationIssue) {
    const target = issueTarget(issue);
    const selector = target.field
      ? `[data-field="${CSS.escape(target.field)}"]${target.index !== undefined ? `[data-concept-index="${target.index}"]` : ""}`
      : "";
    const control = selector
      ? form.current?.querySelector<HTMLElement>(selector)
      : null;
    if (control) {
      control.closest("details")?.setAttribute("open", "");
      control.scrollIntoView({ block: "center", behavior: "instant" });
      control.focus();
    } else
      document
        .getElementById("studio-" + issue.section)
        ?.scrollIntoView({ block: "center", behavior: "instant" });
  }
  function errorFor(field: string, index?: number) {
    return [...(evaluation?.validation.issues ?? []), ...issues].find(
      (issue) => {
        const target = issueTarget(issue);
        return (
          issue.severity === "ERROR" &&
          target.field === field &&
          target.index === index
        );
      },
    )?.message;
  }
  async function save() {
    if (!draft || !context || locked.current || conflict || uncertain) return;
    locked.current = true;
    evaluationRequest.current?.abort();
    setValidating(false);
    setBusy("save");
    setMessage("");
    let accepted = false;
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const result = readSaved(
        await studioRequest(
          "/api/outgoing-invoices" +
            (saved ? "/" + encodeURIComponent(saved.id) : ""),
          {
            method: saved ? "PATCH" : "POST",
            headers: {
              "Content-Type": "application/json",
              ...(!saved ? { "Idempotency-Key": idempotencyKey.current } : {}),
            },
            body: JSON.stringify({
              ...draft,
              ...(saved ? { expectedUpdatedAt: saved.updatedAt } : {}),
            }),
          },
        ),
      );
      accepted = true;
      setSaved(result);
      setEvaluation(result);
      setDirty(false);
      setIssues([]);
      setValidationError("");
      const detail = readDetail(
        await studioRequest(
          "/api/outgoing-invoices/" + encodeURIComponent(result.id),
        ),
      );
      setSnapshot(detail);
      setDraft(draftRequest(detail));
      setEvaluation(detail);
      setSaved(detail);
      setKeys(detail.concepts.map((_, i) => keys[i] ?? `saved-${i}`));
      setMessage(
        "Borrador guardado. Puedes continuar editando o revisar el documento.",
      );
    } catch (error) {
      if (error instanceof StudioRequestError) {
        setIssues(error.issues ?? []);
        if (error.status === 409 && saved && !error.issues?.length)
          setConflict(true);
      }
      if (accepted)
        setMessage(
          "El borrador se guardó, pero no pudimos recuperar su detalle. Abre el borrador guardado para revisarlo.",
        );
      else {
        if (!(error instanceof StudioRequestError) || error.status >= 500)
          setUncertain(true);
        setMessage((error as Error).message);
      }
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  async function markReady() {
    if (
      !saved ||
      !draft ||
      dirty ||
      !evaluation?.validation.canMarkReady ||
      draft.documentType !== "I" ||
      locked.current ||
      conflict ||
      uncertain
    )
      return;
    locked.current = true;
    setBusy("ready");
    setMessage("");
    try {
      await studioRequest(
        `/api/outgoing-invoices/${encodeURIComponent(saved.id)}/ready`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedUpdatedAt: saved.updatedAt }),
        },
      );
      const detail = readDetail(
        await studioRequest(
          "/api/outgoing-invoices/" + encodeURIComponent(saved.id),
        ),
      );
      if (detail.status !== "READY" || detail.documentType !== "I")
        throw new Error(
          "El servidor no confirmó que este borrador esté listo. Revisa su validación.",
        );
      setSaved(detail);
      setSnapshot(detail);
      setEvaluation(detail);
      setMessage("Borrador listo para revisión. Documento aún no timbrado.");
    } catch (error) {
      setEvaluation(undefined);
      setMessage((error as Error).message);
      if (error instanceof StudioRequestError) {
        setIssues(error.issues ?? []);
        if (error.status === 409 && !error.issues?.length) setConflict(true);
      }
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  if (loadError || !context || !draft)
    return (
      <div className="invoice-studio studio-card p-6" aria-busy={!loadError}>
        <h2 className="text-lg font-semibold">
          {loadError
            ? "Invoice Studio está pendiente de integración"
            : "Preparando tu espacio de facturación…"}
        </h2>
        <p
          className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400"
          role="status"
        >
          {loadError ||
            "Cargando el emisor, tus clientes y los catálogos fiscales."}
        </p>
        {loadError && (
          <>
            <p className="mt-3 text-sm text-zinc-400">
              No podemos iniciar el editor hasta disponer de sus datos. Tus
              borradores existentes permanecen conservados.
            </p>
            <Button
              className="mt-5"
              variant="secondary"
              onClick={() => {
                setLoadError("");
                setReload((value) => value + 1);
              }}
            >
              Volver a cargar
            </Button>
          </>
        )}
      </div>
    );
  const receiver =
    snapshot?.clientId === draft.clientId
      ? snapshot.receiverSnapshot
      : context.clients.find((client) => client.id === draft.clientId);
  const issuer = snapshot?.issuerSnapshot ?? context.issuer;
  const canReady =
    !!saved &&
    snapshot?.updatedAt === saved.updatedAt &&
    !dirty &&
    !busy &&
    !conflict &&
    !uncertain &&
    !!evaluation?.validation.canMarkReady &&
    draft.documentType === "I" &&
    saved.status !== "READY";
  return (
    <div className="invoice-studio">
      <div className="studio-toolbar">
        <div>
          <span className="studio-badge">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            {dirty
              ? "Cambios sin guardar"
              : saved?.status === "READY"
                ? "Listo para revisión"
                : saved
                  ? "Borrador guardado"
                  : "Nuevo borrador"}
          </span>
          <p className="mt-2 text-xs text-zinc-400">
            {saved?.folio ??
              "El folio se asigna al guardar. Vista previa sin timbre fiscal."}
          </p>
        </div>
        <Link className="studio-link" href="/dashboard/invoices/settings">
          Administrar facturas
        </Link>
      </div>
      <form
        ref={form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {(conflict || uncertain) && (
          <div className="studio-notice mb-5" role="alert">
            <p>
              {conflict
                ? "Otro cambio actualizó este borrador. Tu captura permanece aquí y no se sobrescribirá. Abre la versión guardada en otra pestaña para compararla antes de recargar."
                : "No podemos confirmar el guardado. Conservamos tu captura y bloqueamos nuevos envíos para evitar duplicados. Revisa los borradores guardados antes de recargar."}
            </p>
            {saved && (
              <Link
                className="studio-link mt-2 inline-block"
                target="_blank"
                href={
                  "/dashboard/invoices/new?draft=" +
                  encodeURIComponent(saved.id)
                }
              >
                Abrir versión guardada
              </Link>
            )}
          </div>
        )}
        <div className="studio-layout">
          <fieldset
            disabled={!!busy || conflict || uncertain}
            className="min-w-0 space-y-5"
          >
            <legend className="sr-only">Editor de factura</legend>
            <DocumentSections
              context={context}
              issuer={issuer}
              receiver={receiver}
              draft={draft}
              folio={saved?.folio}
              onChange={change}
              errorFor={errorFor}
              onClientChange={(id) => {
                const previous = context.clients.find(
                    (client) => client.id === draft.clientId,
                  ),
                  next = context.clients.find((client) => client.id === id);
                invalidate();
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        clientId: id,
                        cfdiUse:
                          !current.cfdiUse ||
                          current.cfdiUse === previous?.cfdiUse
                            ? (next?.cfdiUse ?? "")
                            : current.cfdiUse,
                        paymentForm:
                          !current.paymentForm ||
                          current.paymentForm === previous?.defaultPaymentForm
                            ? (next?.defaultPaymentForm ??
                              context.settings.paymentFormDefault)
                            : current.paymentForm,
                      }
                    : current,
                );
              }}
            />
            <ConceptEditor
              context={context}
              concepts={draft.concepts}
              keys={keys}
              onKeysChange={setKeys}
              onChange={(lines) => change("concepts", lines)}
              totals={evaluation?.totals}
              currency={draft.currency}
              errorFor={errorFor}
            />
          </fieldset>
          <aside className="studio-summary">
            <TotalsSummary
              totals={evaluation?.totals}
              currency={draft.currency}
              busy={validating}
            />
            <ValidationPanel
              result={evaluation?.validation}
              busy={validating}
              error={validationError}
              issues={issues}
              onFocusIssue={focusIssue}
            />
            <Button
              variant="secondary"
              disabled={!!busy || validating || conflict || uncertain}
              onClick={() => {
                void validate();
              }}
            >
              <Check className="size-4" aria-hidden="true" />
              Validar datos
            </Button>
          </aside>
        </div>
        <div className="studio-actions">
          <p className="text-sm text-zinc-400">
            Puedes guardar con observaciones fiscales. La validación del
            servidor determina si el borrador está listo.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={!!busy}
              onClick={() => setView("preview")}
            >
              <Eye className="size-4" aria-hidden="true" />
              Vista previa
            </Button>
            <Button
              variant="secondary"
              disabled={!!busy}
              onClick={() => setView("review")}
            >
              <FileCheck2 className="size-4" aria-hidden="true" />
              Revisión final
            </Button>
            <Button type="submit" disabled={!!busy || conflict || uncertain}>
              <Save className="size-4" aria-hidden="true" />
              {busy === "save" ? "Guardando…" : "Guardar borrador"}
            </Button>
          </div>
          <p role="status" className="text-sm text-zinc-300">
            {message}
          </p>
          {saved && (
            <Link
              className="studio-link"
              href={
                "/dashboard/invoices/new?draft=" + encodeURIComponent(saved.id)
              }
            >
              Abrir borrador guardado
            </Link>
          )}
        </div>
      </form>
      {view && (
        <InvoicePreview
          mode={view}
          context={context}
          issuer={issuer}
          receiver={receiver}
          draft={draft}
          folio={saved?.folio}
          totals={evaluation?.totals}
          validation={evaluation?.validation}
          busy={!!busy}
          canReady={canReady}
          message={message}
          onClose={() => setView(null)}
          onReady={() => {
            void markReady();
          }}
        />
      )}
    </div>
  );
}
