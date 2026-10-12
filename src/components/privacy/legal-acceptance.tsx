"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LegalAcceptanceState, LegalDocumentSummary } from "@/types/legal";
import { FormFeedback } from "@/components/forms/form-feedback";
import {
  LegalUiError,
  readLegalAcceptances,
  submitLegalAcceptance,
} from "./legal-transport";

type DisplayedDocument = Pick<
  LegalDocumentSummary,
  "kind" | "status" | "version" | "contentHash"
>;

export function LegalAcceptance({ document }: { document: DisplayedDocument }) {
  const { kind, version, contentHash, status } = document;
  const [state, setState] = useState<LegalAcceptanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [requiresReview, setRequiresReview] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const post = useRef<AbortController | null>(null);
  useEffect(() => () => post.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    readLegalAcceptances(controller.signal)
      .then((states) => {
        if (controller.signal.aborted) return;
        const current = states.find((candidate) => candidate.document === kind);
        if (!current)
          throw new LegalUiError(
            "No pudimos consultar el estado de aceptación.",
            503,
          );
        setState(current);
        setLoading(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setSignedOut(cause instanceof LegalUiError && cause.status === 401);
        if (!(cause instanceof LegalUiError && cause.status === 401))
          setError(
            cause instanceof LegalUiError
              ? cause.message
              : "No pudimos consultar el estado de aceptación.",
          );
        setLoading(false);
      });
    return () => controller.abort();
  }, [kind, version, contentHash, attempt]);

  const matching =
    state?.version === version && state?.contentHash === contentHash;
  const available =
    status === "PUBLISHED" &&
    matching &&
    state?.status === "PUBLISHED" &&
    state.acceptable;
  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submitting.current ||
      !available ||
      !checked ||
      blocked ||
      state?.accepted
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    post.current = controller;
    try {
      const acceptedAt = await submitLegalAcceptance(
        { document: kind, version, contentHash },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setState((current) =>
          current ? { ...current, accepted: true, acceptedAt } : current,
        );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof LegalUiError
            ? cause.message
            : "No pudimos confirmar la aceptación. Consulta de nuevo su estado.",
        );
        setBlocked(true);
        setRequiresReview(
          cause instanceof LegalUiError && cause.requiresReview,
        );
        setChecked(false);
      }
    } finally {
      submitting.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function reloadState() {
    setState(null);
    setChecked(false);
    setError("");
    setBlocked(false);
    setRequiresReview(false);
    setSignedOut(false);
    setLoading(true);
    setAttempt((value) => value + 1);
  }

  return (
    <section
      aria-labelledby="legal-acceptance-heading"
      className="surface mt-8 rounded-2xl p-5"
    >
      <h2 id="legal-acceptance-heading">Aceptación personal</h2>
      <p>
        Se registra para tu cuenta y esta versión del documento. Es
        independiente de las cookies y de la autorización para leer documentos
        fiscales.
      </p>
      {loading ? (
        <FormFeedback message="Consultando tu aceptación…" busy />
      ) : signedOut ? (
        <p>
          <Link href="/login" className="underline">
            Inicia sesión
          </Link>{" "}
          para consultar o registrar tu aceptación.
        </p>
      ) : status === "DRAFT" || (state && !state.acceptable) ? (
        <p>Este documento está en revisión y no puede aceptarse.</p>
      ) : state && !matching ? (
        <p>
          El documento cambió. Recarga la página y revisa la versión vigente
          antes de aceptarla.
        </p>
      ) : state?.accepted && matching ? (
        <FormFeedback
          message={`Aceptación registrada${state.acceptedAt ? ` el ${new Intl.DateTimeFormat("es-MX", { dateStyle: "long" }).format(new Date(state.acceptedAt))}` : ""}.`}
        />
      ) : available ? (
        <form ref={form} onSubmit={accept}>
          <label className="flex items-start gap-3 py-3">
            <input
              className="mt-1 h-5 w-5 shrink-0"
              type="checkbox"
              name="legalAcceptance"
              checked={checked}
              disabled={busy || blocked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>
              He leído y acepto la versión {version} de este documento.
            </span>
          </label>
          <button
            className="btn-secondary min-h-11"
            type="submit"
            disabled={!checked || busy || blocked}
          >
            {busy ? "Registrando aceptación…" : "Registrar mi aceptación"}
          </button>
          <FormFeedback
            message={error}
            error={!!error}
            busy={busy}
            scope={form}
          />
        </form>
      ) : null}
      {!available && error && <FormFeedback message={error} error />}
      {!busy &&
        !requiresReview &&
        (blocked || (!loading && !signedOut && !state)) && (
          <button className="btn-secondary min-h-11 mt-4" onClick={reloadState}>
            Consultar de nuevo el estado
          </button>
        )}
      {!loading &&
        state &&
        (requiresReview || !matching || !state.acceptable) &&
        status === "PUBLISHED" && (
          <button
            className="btn-secondary min-h-11 mt-4"
            onClick={() => window.location.reload()}
          >
            Recargar documento vigente
          </button>
        )}
    </section>
  );
}
