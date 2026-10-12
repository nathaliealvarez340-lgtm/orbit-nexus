"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CsdState,
  CsdCustodyTerms,
  CsdHistoryItem,
  ConfigureCsdResponse,
} from "@/types/csd";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/forms/form-feedback";
import { CsdStatusCard, CsdHistory } from "./csd-status";
import { CsdConfirmDialog } from "./csd-confirm-dialog";
import { CsdUploadForm } from "./csd-upload-form";
import { csdTransport, CsdUiError, type CsdTransport } from "./transport";
import "./csd.css";

export function CsdManager({
  transport = csdTransport,
}: {
  transport?: CsdTransport;
}) {
  const [state, setState] = useState<CsdState>(),
    [terms, setTerms] = useState<CsdCustodyTerms>();
  const [history, setHistory] = useState<CsdHistoryItem[]>();
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [extraError, setExtraError] = useState("");
  const [forbidden, setForbidden] = useState(false),
    [reauth, setReauth] = useState(false);
  const [blocked, setBlocked] = useState(false),
    [formOpen, setFormOpen] = useState(true);
  const [replaceId, setReplaceId] = useState<string>();
  const [confirm, setConfirm] = useState<"replace" | "disable" | null>(null);
  const request = useRef<AbortController | null>(null),
    mutation = useRef<AbortController | null>(null),
    lock = useRef(false);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const value = await transport.state(controller.signal);
      if (controller.signal.aborted) return;
      setExtraError("");
      setState(value);
      setForbidden(false);
      const extras = await Promise.allSettled([
        transport.history(controller.signal),
        transport.terms(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const denied = extras.find(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof CsdUiError &&
          [401, 403].includes(result.reason.status),
      );
      if (denied?.status === "rejected") throw denied.reason;
      setHistory(
        extras[0].status === "fulfilled" ? extras[0].value : undefined,
      );
      setTerms(extras[1].status === "fulfilled" ? extras[1].value : undefined);
      if (extras.some((result) => result.status === "rejected"))
        setExtraError(
          "No pudimos consultar el historial o los términos de custodia. Vuelve a cargar antes de configurar.",
        );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setState(undefined);
        setHistory(undefined);
        setTerms(undefined);
        setForbidden(cause instanceof CsdUiError && cause.status === 403);
        setReauth(cause instanceof CsdUiError && cause.status === 401);
        setError(
          cause instanceof CsdUiError
            ? cause.message
            : "No pudimos consultar el estado del CSD. Vuelve a cargar.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [transport]);
  useEffect(() => {
    // Remote-state synchronization: setters run only after the API settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      request.current?.abort();
      mutation.current?.abort();
    };
  }, [load]);

  function failure(cause: unknown) {
    const known = cause instanceof CsdUiError;
    const code = known ? cause.code : undefined;
    setMessage("");
    if (known && cause.status === 403) {
      setForbidden(true);
      setState(undefined);
      setHistory(undefined);
      setTerms(undefined);
    }
    if (known && cause.status === 401) setReauth(true);
    const refresh =
      !known ||
      !code ||
      [
        "CSD_CONFLICT",
        "CSD_ALREADY_ACTIVE",
        "CSD_NOT_FOUND",
        "CSD_ENCRYPTION_FAILED",
        "CSD_SERVICE_UNAVAILABLE",
        "CSD_CUSTODY_TERMS_REQUIRED",
      ].includes(code);
    if (refresh || (known && [401, 403].includes(cause.status))) {
      setBlocked(true);
      setReplaceId(undefined);
      setFormOpen(false);
      setError(
        known
          ? cause.message
          : "No pudimos confirmar el resultado. Consulta el estado antes de repetir.",
      );
      if (refresh) {
        setLoading(true);
        void load();
      }
      return true;
    }
    return false;
  }
  function saved(value: ConfigureCsdResponse) {
    setState(value);
    setReplaceId(undefined);
    setFormOpen(false);
    setError("");
    setMessage(
      value.created
        ? "CSD configurado correctamente. No se emitió ninguna factura."
        : "Este certificado ya estaba configurado. No se creó un duplicado.",
    );
    setLoading(true);
    void load();
  }
  async function disable() {
    if (lock.current || !state?.id || !state.canManage) return;
    lock.current = true;
    setConfirm(null);
    setBusy(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    mutation.current = controller;
    try {
      const value = await transport.disable(
        { expectedActiveCsdId: state.id, confirm: true },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setState(value);
        setFormOpen(false);
        setReplaceId(undefined);
        setMessage(
          "CSD deshabilitado. Su llave privada cifrada fue eliminada.",
        );
        setLoading(true);
        void load();
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        failure(cause);
        setError(
          cause instanceof CsdUiError
            ? cause.message
            : "No pudimos confirmar la deshabilitación. Consulta el estado antes de repetir.",
        );
      }
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function reload() {
    setError("");
    setMessage("");
    setBlocked(false);
    setReauth(false);
    setReplaceId(undefined);
    setFormOpen(true);
    setLoading(true);
    void load();
  }
  const canAct =
    !!state?.canManage &&
    !busy &&
    !loading &&
    !blocked &&
    !reauth &&
    !forbidden;
  return (
    <div className="csd-ui" aria-busy={loading || busy}>
      <FormFeedback message={error || message} error={!!error} />
      {busy && (
        <p role="status" className="csd-help">
          Procesando la operación CSD…
        </p>
      )}
      {reauth && (
        <p className="csd-warning">
          <Link
            className="csd-link"
            href="/login?returnTo=%2Fdashboard%2Fstamping"
          >
            Volver a iniciar sesión y regresar a CSD
          </Link>
        </p>
      )}
      {forbidden ? (
        <p className="csd-warning">
          Solo un administrador puede ver y gestionar el CSD.
        </p>
      ) : (
        <>
          {loading && (
            <p role="status" className="csd-help">
              Consultando configuración de CSD…
            </p>
          )}
          {state && <CsdStatusCard state={state} />}
          {!busy && !reauth && (
            <div className="csd-actions">
              <Button variant="secondary" disabled={loading} onClick={reload}>
                Volver a cargar estado
              </Button>
            </div>
          )}
          {blocked && (
            <p className="csd-warning">
              Revisa el estado actualizado y pulsa Volver a cargar estado antes
              de repetir. Los nuevos envíos están bloqueados.
            </p>
          )}
          {state?.id && !replaceId && (
            <div className="csd-actions">
              <Button
                variant="secondary"
                disabled={!canAct || !state.serviceAvailable || !terms}
                onClick={() => setConfirm("replace")}
              >
                Sustituir CSD
              </Button>
              <Button
                variant="secondary"
                className="csd-destructive"
                disabled={!canAct}
                onClick={() => setConfirm("disable")}
              >
                Deshabilitar CSD
              </Button>
            </div>
          )}
          {state &&
            state.canManage &&
            state.serviceAvailable &&
            !reauth &&
            !blocked &&
            !loading &&
            ((!state.id && formOpen) || replaceId) &&
            terms && (
              <div className="csd-layout">
                <CsdUploadForm
                  key={`${terms.version}:${replaceId ?? "new"}`}
                  terms={terms}
                  replaceId={replaceId}
                  transport={transport}
                  onSaved={saved}
                  onFailure={failure}
                  onBusy={setBusy}
                  onCancel={() => {
                    setBusy(false);
                    setReplaceId(undefined);
                    setFormOpen(false);
                    setBlocked(true);
                    setError(
                      "La captura fue descartada. Consulta el estado antes de continuar; salir no confirma la cancelación de una solicitud ya enviada.",
                    );
                    setLoading(true);
                    void load();
                  }}
                />
                <aside className="surface p-5">
                  <h2>Custodia segura</h2>
                  <p className="csd-help">
                    La Constancia de Situación Fiscal identifica información
                    fiscal.
                  </p>
                  <p className="csd-help">
                    El Certificado de Sello Digital se utiliza para sellar CFDI.
                  </p>
                  <p className="csd-help">
                    Solo propietarios y administradores pueden configurar y
                    administrar el CSD. La contraseña no se conserva; la llave
                    queda cifrada. Configurar el CSD no autoriza ninguna
                    factura.
                  </p>
                  <Link
                    className="csd-link mt-4"
                    href="/dashboard/fiscal-profile"
                  >
                    Revisar Perfil Fiscal
                  </Link>
                </aside>
              </div>
            )}
          <FormFeedback message={extraError} error={!!extraError} />
          {history && <CsdHistory items={history} />}
          {confirm && state?.id && (
            <CsdConfirmDialog
              action={confirm}
              certificateNumber={state.certificateNumber}
              onClose={() => setConfirm(null)}
              onConfirm={() => {
                if (confirm === "disable") void disable();
                else {
                  setReplaceId(state.id!);
                  setConfirm(null);
                  setError("");
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
