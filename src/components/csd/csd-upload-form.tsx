"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConfigureCsdResponse, CsdCustodyTerms } from "@/types/csd";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/forms/form-feedback";
import { CsdUiError, type CsdTransport } from "./transport";

export function CsdUploadForm({
  terms,
  replaceId,
  transport,
  onSaved,
  onFailure,
  onBusy,
  onCancel,
}: {
  terms: CsdCustodyTerms;
  replaceId?: string;
  transport: CsdTransport;
  onSaved: (value: ConfigureCsdResponse) => void;
  onFailure: (cause: unknown) => boolean;
  onBusy: (value: boolean) => void;
  onCancel: () => void;
}) {
  const form = useRef<HTMLFormElement>(null),
    request = useRef<AbortController | null>(null),
    lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(""),
    [fields, setFields] = useState<string[]>([]);
  const [passwordReady, setPasswordReady] = useState(false);
  useEffect(() => {
    const element = form.current;
    if (replaceId)
      (
        element?.elements.namedItem("certificate") as HTMLInputElement | null
      )?.focus();
    const clear = () => {
      element?.reset();
      request.current?.abort();
    };
    window.addEventListener("pagehide", clear);
    return () => {
      clear();
      window.removeEventListener("pagehide", clear);
    };
  }, [replaceId]);
  function cancel() {
    request.current?.abort();
    form.current?.reset();
    setPasswordReady(false);
    setAccepted(false);
    onCancel();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const element = event.currentTarget;
    const certificate = element.elements.namedItem(
      "certificate",
    ) as HTMLInputElement;
    const privateKey = element.elements.namedItem(
      "privateKey",
    ) as HTMLInputElement;
    const password = element.elements.namedItem("password") as HTMLInputElement;
    // The only password copy is the outgoing multipart. No password in React state/ref.
    const body = new FormData(element);
    password.value = "";
    setPasswordReady(false);
    const invalid: string[] = [];
    if (
      !certificate.files?.[0]?.size ||
      !/\.cer$/i.test(certificate.files[0].name) ||
      certificate.files[0].size > 16384
    )
      invalid.push("certificate");
    if (
      !privateKey.files?.[0]?.size ||
      !/\.key$/i.test(privateKey.files[0].name) ||
      privateKey.files[0].size > 16384
    )
      invalid.push("privateKey");
    if (
      typeof body.get("password") !== "string" ||
      !(body.get("password") as string).length ||
      (body.get("password") as string).length > 256
    )
      invalid.push("password");
    if (!accepted) invalid.push("accepted");
    if (invalid.length) {
      body.delete("password");
      body.delete("privateKey");
      body.delete("certificate");
      setFields(invalid);
      setError(
        "Selecciona un .cer y un .key no vacíos, de hasta 16 KiB cada uno, escribe la contraseña y acepta los términos de custodia.",
      );
      return;
    }
    body.set("accepted", "true");
    body.set("custodyTermsVersion", terms.version);
    if (replaceId) {
      body.set("replace", "true");
      body.set("expectedActiveCsdId", replaceId);
    }
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setFields([]);
    const controller = new AbortController();
    request.current = controller;
    try {
      const value = await transport.configure(body, controller.signal);
      if (!controller.signal.aborted) {
        element.reset();
        setAccepted(false);
        onSaved(value);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setAccepted(false);
        const clear = onFailure(cause);
        if (clear) element.reset();
        setError(
          cause instanceof CsdUiError
            ? cause.message
            : "No pudimos confirmar la operación. Consulta el estado antes de continuar.",
        );
        const code = cause instanceof CsdUiError ? cause.code : undefined;
        setFields(
          code === "CSD_PASSWORD_INVALID"
            ? ["password"]
            : code === "CSD_CERTIFICATE_INVALID"
              ? ["certificate"]
              : code === "CSD_KEY_INVALID"
                ? ["privateKey"]
                : code === "CSD_CUSTODY_TERMS_REQUIRED"
                  ? ["accepted"]
                  : [],
        );
      }
    } finally {
      body.delete("password");
      body.delete("privateKey");
      body.delete("certificate");
      lock.current = false;
      if (!controller.signal.aborted) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <form
      ref={form}
      className="surface csd-form"
      aria-busy={busy}
      noValidate
      onSubmit={submit}
    >
      <h2>{replaceId ? "Cargar el CSD sustituto" : "Configurar CSD"}</h2>
      {replaceId && (
        <p className="csd-warning">
          La sustitución elimina la llave privada cifrada anterior únicamente
          después de validar y guardar el nuevo CSD.
        </p>
      )}
      <fieldset disabled={busy}>
        <label>
          Certificado .cer
          <input
            className="input"
            name="certificate"
            type="file"
            accept=".cer"
            required
            aria-describedby="csd-file-help"
          />
        </label>
        <label>
          Llave privada .key
          <input
            className="input"
            name="privateKey"
            type="file"
            accept=".key"
            required
            aria-describedby="csd-file-help"
          />
        </label>
        <p className="csd-help" id="csd-file-help">
          Hasta 16 KiB por archivo. Seleccionarlos no inicia la carga. No subas
          tu e.firma (FIEL). ORBIT nunca la solicita.
        </p>
        <label>
          Contraseña de la llave privada
          <PasswordInput
            name="password"
            autoComplete="off"
            maxLength={256}
            required
            aria-describedby="csd-password-help"
            onInput={(event) => setPasswordReady(!!event.currentTarget.value)}
          />
        </label>
        <p id="csd-password-help" className="csd-help">
          Se utiliza una sola vez y desaparece del campo al enviar. No se guarda
          ni se registra. En un reintento deberás escribirla de nuevo.
        </p>
        <section className="csd-terms" aria-label="Términos de custodia">
          <h3>Términos de custodia · {terms.version}</h3>
          {terms.text.split(/\n\n+/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>
        <label className="csd-check">
          <input
            name="accepted"
            type="checkbox"
            value="true"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span>
            He leído y acepto los términos de custodia de esta versión.
          </span>
        </label>
      </fieldset>
      <FormFeedback
        message={error}
        error={!!error}
        busy={busy}
        fields={fields}
        scope={form}
      />
      <div className="csd-actions">
        <Button type="submit" disabled={busy || !accepted || !passwordReady}>
          {busy
            ? "Validando y protegiendo CSD…"
            : replaceId
              ? "Validar y sustituir CSD"
              : "Validar y configurar CSD"}
        </Button>
        <Button variant="secondary" onClick={cancel}>
          {busy ? "Salir y consultar el estado" : "Cancelar y limpiar"}
        </Button>
      </div>
    </form>
  );
}
