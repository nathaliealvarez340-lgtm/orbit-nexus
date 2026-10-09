"use client";
import { useEffect, useRef, useState } from "react";
import type {
  FiscalConsentPurpose,
  FiscalConsentTerms,
  FiscalExtractionResult,
  PrivateAssetUploadResponse,
} from "@/types/fiscal-identity";
import { Button } from "@/components/ui/button";
import { FiscalConsent } from "./fiscal-consent";
import {
  extractAuthorizedCsf,
  fiscalErrorMessage,
  FiscalUiError,
  type CsfTransport,
} from "./transport";

export function CsfPrefill({
  purpose,
  clientId,
  documentId,
  transport,
  onDocument,
  onExtraction,
  onBusy,
  disabled = false,
}: {
  purpose: FiscalConsentPurpose;
  clientId?: string;
  documentId?: string;
  transport: CsfTransport;
  onDocument: (id: string) => void;
  onExtraction: (result: FiscalExtractionResult | null) => void;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [document, setDocument] = useState<PrivateAssetUploadResponse | null>(
    documentId ? { id: documentId, fileName: "Constancia registrada" } : null,
  );
  const [accepted, setAccepted] = useState(false);
  const [terms, setTerms] = useState<FiscalConsentTerms>();
  const [busy, setBusy] = useState<"upload" | "extract" | null>(null);
  const [error, setError] = useState("");
  const [termsAttempt, setTermsAttempt] = useState(0);
  const [termsLoading, setTermsLoading] = useState(!!transport.terms);
  const [unavailable, setUnavailable] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!transport.terms) return;
    const controller = new AbortController();
    transport
      .terms(purpose, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && data.purpose === purpose) {
          setTerms(data);
          setAccepted(false);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            fiscalErrorMessage(
              failure,
              "No pudimos cargar la autorización de lectura. Puedes continuar manualmente.",
            ),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setTermsLoading(false);
      });
    return () => controller.abort();
  }, [purpose, transport, termsAttempt]);
  const connected =
    !!transport.consent && !!transport.extract && !!terms && !termsLoading;
  const client = purpose === "CLIENT_FISCAL_PREFILL";
  return (
    <section
      aria-label={
        client
          ? "Constancia opcional del cliente"
          : "Constancia de Situación Fiscal"
      }
      className="fiscal-csf"
      aria-busy={!!busy}
    >
      <h2 className="font-medium">
        {client
          ? "Constancia del cliente · opcional"
          : "1. Constancia de Situación Fiscal"}
      </h2>
      <p className="fiscal-help">
        {client
          ? "Opcional pero recomendada para autocompletar y reducir errores de captura. Puedes crear el cliente manualmente sin este documento."
          : "Carga tu PDF privado antes de capturar los datos. Subirlo no autoriza su lectura ni confirma la información."}
      </p>
      <label className="fiscal-file-label">
        Constancia de Situación Fiscal · PDF, hasta 10 MB
        <input
          className="input mt-2"
          type="file"
          accept=".pdf,application/pdf"
          disabled={
            disabled ||
            unavailable ||
            !!busy ||
            !transport.upload ||
            (client && !clientId)
          }
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file || !transport.upload || lock.current) return;
            setAccepted(false);
            setError("");
            onExtraction(null);
            if (!/\.pdf$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
              setError("Selecciona un PDF de hasta 10 MB.");
              return;
            }
            lock.current = true;
            setBusy("upload");
            onBusy?.(true);
            try {
              const uploaded = await transport.upload(file);
              setDocument(uploaded);
              onDocument(uploaded.id);
            } catch (failure) {
              setError(
                fiscalErrorMessage(
                  failure,
                  "No pudimos cargar la constancia. Puedes revisar el archivo o continuar manualmente.",
                ),
              );
            } finally {
              lock.current = false;
              setBusy(null);
              onBusy?.(false);
            }
          }}
        />
      </label>
      {document && (
        <p className="fiscal-help">
          Documento privado: {document.fileName} ·{" "}
          <a
            className="underline"
            href={`/api/documents/${encodeURIComponent(document.id)}`}
          >
            Ver archivo privado
          </a>
        </p>
      )}
      {termsLoading && (
        <p role="status" className="fiscal-help">
          Cargando términos de autorización…
        </p>
      )}
      <FiscalConsent
        purpose={purpose}
        terms={terms}
        accepted={accepted}
        onChange={setAccepted}
        disabled={
          disabled ||
          unavailable ||
          !!busy ||
          !document ||
          !connected ||
          (client && !clientId)
        }
      />
      {!connected && (
        <p className="fiscal-pending">
          La autorización de lectura aún no está disponible. Puedes completar y
          guardar los datos manualmente.
        </p>
      )}
      {terms && terms.privacyNoticeVersion === null && (
        <p className="fiscal-pending">
          Aviso de Privacidad sin versión publicada. El backend permite pruebas
          locales y bloquea el procesamiento productivo sin aviso vigente. Esta
          operación no representa aprobación para producción.
        </p>
      )}
      {client && !clientId && (
        <p className="fiscal-help">
          Guarda primero el cliente. Después podrás editarlo y cargar su
          constancia opcional.
        </p>
      )}
      <Button
        variant="secondary"
        disabled={
          disabled ||
          unavailable ||
          !!busy ||
          !accepted ||
          !document ||
          !connected ||
          (client && !clientId)
        }
        onClick={async () => {
          if (
            lock.current ||
            !connected ||
            !accepted ||
            !document ||
            !terms ||
            !transport.consent ||
            !transport.extract
          )
            return;
          lock.current = true;
          setBusy("extract");
          setError("");
          onBusy?.(true);
          try {
            const result = await extractAuthorizedCsf(transport, {
              documentId: document.id,
              purpose,
              ...(client ? { clientId } : {}),
              accepted: true,
              consentVersion: terms.consentVersion,
              privacyNoticeVersion: terms.privacyNoticeVersion,
            });
            onExtraction(result);
          } catch (failure) {
            setError(
              fiscalErrorMessage(
                failure,
                "No pudimos leer la constancia. Puedes intentarlo nuevamente o completar los datos manualmente.",
              ),
            );
            if (failure instanceof FiscalUiError) {
              if (failure.code === "CLIENT_NOT_AVAILABLE") setUnavailable(true);
              if (
                [
                  "CONSENT_REQUIRED",
                  "CONSENT_VERSION_OUTDATED",
                  "PRIVACY_NOTICE_OUTDATED",
                ].includes(failure.code ?? "")
              ) {
                setTerms(undefined);
                setAccepted(false);
              }
            }
          } finally {
            lock.current = false;
            setBusy(null);
            onBusy?.(false);
          }
        }}
      >
        {busy === "extract"
          ? "Leyendo constancia…"
          : "Leer y prellenar constancia"}
      </Button>
      {!busy && !termsLoading && !terms && transport.terms && (
        <Button
          variant="secondary"
          disabled={disabled || unavailable}
          onClick={() => {
            setTermsLoading(true);
            setAccepted(false);
            setError("");
            setTermsAttempt((attempt) => attempt + 1);
          }}
        >
          Actualizar autorización
        </Button>
      )}
      {busy && (
        <p role="status" className="fiscal-help">
          {busy === "upload"
            ? "Cargando documento privado…"
            : "Registrando autorización y leyendo el documento…"}
        </p>
      )}
      {error && (
        <p role="alert" className="fiscal-error">
          ⚠ {error}
        </p>
      )}
    </section>
  );
}
