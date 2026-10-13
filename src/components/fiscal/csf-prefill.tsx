"use client";
import { useEffect, useId, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import type {
  FiscalConsentPurpose,
  FiscalConsentTerms,
  FiscalExtractionResult,
  PrivateAssetUploadResponse,
} from "@/types/fiscal-identity";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/forms/form-feedback";
import { FiscalConsent } from "./fiscal-consent";
import { invalidatesPendingCsf, pendingCsfExpired } from "./client-csf-prefill";
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
  onUpload,
  onExtraction,
  onBusy,
  disabled = false,
}: {
  purpose: FiscalConsentPurpose;
  clientId?: string;
  documentId?: string;
  transport: CsfTransport;
  onDocument: (id: string) => void;
  onUpload?: (asset: PrivateAssetUploadResponse | null) => void;
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
  const [selectedName, setSelectedName] = useState("");
  const [read, setRead] = useState(false);
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const fileId = useId();
  const newClient = purpose === "CLIENT_FISCAL_PREFILL" && !clientId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const clearDocument = () => {
    setDocument(null);
    setSelectedName("");
    setAccepted(false);
    setRead(false);
    if (fileInput.current) fileInput.current.value = "";
    onUpload?.(null);
    onExtraction(null);
    onDocument("");
  };
  useEffect(() => {
    if (!newClient || !document?.expiresAt) return;
    const timer = setTimeout(
      () => {
        setDocument(null);
        setSelectedName("");
        setAccepted(false);
        setRead(false);
        onUpload?.(null);
        onExtraction(null);
        setError(
          "La constancia venció. Vuelve a subirla o guarda el cliente sin ella.",
        );
      },
      Math.max(0, Date.parse(document.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [document, newClient, onUpload, onExtraction]);
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
          ? "Constancia de Situación Fiscal · opcional"
          : "1. Constancia de Situación Fiscal"}
      </h2>
      <p className="fiscal-help">
        {client
          ? "Opcional pero recomendada para autocompletar y reducir errores de captura. Puedes crear el cliente manualmente sin este documento."
          : "Carga tu PDF privado antes de capturar los datos. Subirlo no autoriza su lectura ni confirma la información."}
      </p>
      <div className="fiscal-upload">
        <Upload aria-hidden="true" size={28} className="fiscal-upload-icon" />
        <div className="fiscal-upload-body">
          <label className="sr-only" htmlFor={fileId}>
            Constancia de Situación Fiscal
          </label>
          <input
            ref={fileInput}
            id={fileId}
            className="sr-only"
            tabIndex={-1}
            type="file"
            accept=".pdf,application/pdf"
            disabled={disabled || unavailable || !!busy || !transport.upload}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file || !transport.upload || lock.current) return;
              if (newClient) clearDocument();
              else {
                setAccepted(false);
                setRead(false);
                onExtraction(null);
              }
              setSelectedName(file.name);
              setError("");
              if (
                !/\.pdf$/i.test(file.name) ||
                file.size === 0 ||
                file.size > 10 * 1024 * 1024
              ) {
                if (!newClient) setSelectedName("");
                setError("Selecciona un PDF de hasta 10 MB.");
                return;
              }
              lock.current = true;
              setBusy("upload");
              onBusy?.(true);
              try {
                const uploaded = await transport.upload(file);
                if (!mounted.current) return;
                if (newClient && pendingCsfExpired(uploaded))
                  throw new FiscalUiError("PRECREATION_CSF_EXPIRED", 410);
                setDocument(uploaded);
                setSelectedName("");
                onUpload?.(uploaded);
                onDocument(uploaded.id);
              } catch (failure) {
                if (!mounted.current) return;
                if (!newClient) setSelectedName("");
                setError(
                  failure instanceof FiscalUiError &&
                    failure.status === 400 &&
                    !failure.code
                    ? "Sube una constancia PDF válida, no cifrada, de hasta 10 MB."
                    : fiscalErrorMessage(
                        failure,
                        "No pudimos cargar la constancia. Puedes revisar el archivo o continuar manualmente.",
                      ),
                );
              } finally {
                lock.current = false;
                if (mounted.current) {
                  setBusy(null);
                  onBusy?.(false);
                }
              }
            }}
          />
          <Button
            variant="secondary"
            disabled={disabled || unavailable || !!busy || !transport.upload}
            onClick={(event) => {
              uploadButton.current = event.currentTarget;
              fileInput.current?.click();
            }}
          >
            {document || selectedName
              ? "Reemplazar constancia"
              : "Subir constancia"}
          </Button>
          <p className="fiscal-help">PDF, hasta 10 MB</p>
          {(document || selectedName) && (
            <p className="fiscal-upload-name">
              <FileText size={18} aria-hidden="true" />
              <span>{selectedName || document?.fileName}</span>
            </p>
          )}
          {newClient && (document || selectedName) && (
            <Button
              variant="secondary"
              disabled={disabled || !!busy}
              onClick={() => {
                clearDocument();
                setError("");
                uploadButton.current?.focus();
              }}
            >
              Quitar archivo
            </Button>
          )}
          <p role="status" aria-live="polite" className="fiscal-help">
            {busy === "upload"
              ? "Subiendo constancia…"
              : busy === "extract"
                ? "Procesando constancia…"
                : error
                  ? "Revisa el mensaje de la constancia."
                  : read
                    ? "Lectura terminada. Revisa y confirma los datos fiscales."
                    : document
                      ? "Constancia cargada · lista para autorizar su lectura."
                      : selectedName
                        ? "Archivo seleccionado · pendiente de carga válida."
                        : "Sin archivo · puedes capturar los datos manualmente."}
          </p>
        </div>
      </div>
      {document && (
        <p className="fiscal-help">
          Documento privado ·{" "}
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
          (newClient && read)
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
          La lectura automática requiere un Aviso de Privacidad publicado.
          Puedes completar los datos manualmente y conservar la constancia al
          guardar.
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
          (newClient && read)
        }
        onClick={async () => {
          if (
            lock.current ||
            (newClient && read) ||
            !connected ||
            !accepted ||
            !document ||
            !terms ||
            !transport.consent ||
            !transport.extract
          )
            return;
          if (newClient && pendingCsfExpired(document)) {
            clearDocument();
            setError(
              "La constancia venció. Vuelve a subirla o guarda el cliente sin ella.",
            );
            return;
          }
          lock.current = true;
          setBusy("extract");
          setError("");
          onBusy?.(true);
          try {
            const result = await extractAuthorizedCsf(transport, {
              documentId: document.id,
              purpose,
              ...(client
                ? newClient
                  ? { newClient: true as const }
                  : { clientId }
                : {}),
              accepted: true,
              consentVersion: terms.consentVersion,
              privacyNoticeVersion: terms.privacyNoticeVersion,
            });
            if (!mounted.current) return;
            if (newClient && pendingCsfExpired(document))
              throw new FiscalUiError("PRECREATION_CSF_EXPIRED", 410);
            if (
              newClient &&
              result.precreationCsfReference !==
                document.precreationCsfReference
            )
              throw new Error("Lectura no correlacionada.");
            onExtraction(result);
            setRead(true);
          } catch (failure) {
            if (!mounted.current) return;
            setError(
              fiscalErrorMessage(
                failure,
                "No pudimos leer la constancia. Puedes intentarlo nuevamente o completar los datos manualmente.",
              ),
            );
            if (failure instanceof FiscalUiError) {
              if (newClient && invalidatesPendingCsf(failure.code))
                clearDocument();
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
            if (mounted.current) {
              setBusy(null);
              onBusy?.(false);
            }
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
      <FormFeedback message={error} error={!!error} />
    </section>
  );
}
