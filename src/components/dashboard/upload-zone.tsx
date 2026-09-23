"use client";
import Image from "next/image";
import {
  Camera,
  UploadCloud,
  LoaderCircle,
  RefreshCw,
  Check,
  FileText,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
const extensions: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};
export function UploadZone({ fiscal = false }: { fiscal?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const mounted = useRef(true);
  const cameraLock = useRef(false);
  const cameraVersion = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => {});
    }
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  function select(selected: File | null) {
    setError("");
    if (!selected) return;
    cameraVersion.current++;
    setFile(null);
    setPreview("");
    const allowed = fiscal
      ? { ...extensions, "application/xml": ["xml"], "text/xml": ["xml"] }
      : extensions;
    const extension = selected.name.split(".").pop()?.toLowerCase();
    if (!allowed[selected.type]?.includes(extension || "")) {
      setError(
        "Selecciona JPG, JPEG, PNG, WEBP o PDF" +
          (fiscal ? ", o XML fiscal." : "."),
      );
      return;
    }
    if (!selected.size || selected.size > 10 * 1024 * 1024) {
      setError("El archivo debe pesar menos de 10 MB y no estar vacío.");
      return;
    }
    setStream(null);
    setFile(selected);
    setPreview(
      selected.type.startsWith("image/") ? URL.createObjectURL(selected) : "",
    );
  }
  async function camera() {
    if (cameraLock.current) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "La cámara no está disponible aquí. Usa Subir archivo o abre la aplicación con HTTPS.",
      );
      return;
    }
    try {
      cameraLock.current = true;
      const version = ++cameraVersion.current;
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!mounted.current || version !== cameraVersion.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      setStream(media);
      setFile(null);
      setPreview("");
    } catch {
      setError(
        "No pudimos abrir la cámara. Revisa el permiso del dispositivo o usa Subir archivo.",
      );
    } finally {
      cameraLock.current = false;
    }
  }
  function capture() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2400 / v.videoWidth);
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob)
          select(
            new File([blob], "ticket-" + Date.now() + ".jpg", {
              type: "image/jpeg",
            }),
          );
      },
      "image/jpeg",
      0.9,
    );
  }
  async function upload() {
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setStep("Capturando documento…");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(
        fiscal ? "/api/fiscal-documents" : "/api/tickets",
        { method: "POST", body: form },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "No se pudo guardar el documento.");
      if (fiscal) {
        // Discard prefetched profile data before reviewing the new document.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/dashboard/fiscal-profile?document=" + data.id);
        return;
      }
      setStep("Analizando ticket…");
      // A failed provider still leaves the captured ticket available for manual review.
      await fetch("/api/tickets/" + data.id + "/analyze", { method: "POST" });
      // Discard prefetched ticket lists and metrics after a persisted upload.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/dashboard/tickets/" + data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo conectar.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {!fiscal && (
          <Button variant="secondary" onClick={camera} disabled={busy}>
            <Camera className="size-4" />
            Tomar foto
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          <UploadCloud className="size-4" />
          Subir archivo
        </Button>
      </div>
      <input
        ref={input}
        aria-label={
          fiscal ? "Seleccionar documento fiscal" : "Seleccionar ticket"
        }
        type="file"
        className="sr-only"
        accept={
          fiscal
            ? ".jpg,.jpeg,.png,.webp,.pdf,.xml"
            : ".jpg,.jpeg,.png,.webp,.pdf"
        }
        onChange={(e) => select(e.target.files?.[0] || null)}
        disabled={busy}
      />
      {stream ? (
        <div className="space-y-3">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            className="max-h-96 w-full rounded-2xl bg-black"
          />
          <div className="flex gap-3">
            <Button onClick={capture}>
              <Camera className="size-4" />
              Capturar imagen
            </Button>
            <Button variant="ghost" onClick={() => setStream(null)}>
              Cerrar cámara
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) select(e.dataTransfer.files[0]);
          }}
          className="grid min-h-52 place-items-center rounded-3xl border border-dashed border-white/15 bg-white/[.02] p-6 text-center"
        >
          {preview ? (
            /* Local blob/private authenticated image cannot use the public optimizer. */ <Image
              unoptimized
              width={1600}
              height={1200}
              src={preview}
              alt="Vista previa del documento seleccionado"
              className="max-h-80 rounded-xl object-contain"
            />
          ) : (
            <div>
              <FileText className="mx-auto size-9 text-violet-400" />
              <p className="mt-4 text-sm">
                {file
                  ? file.name
                  : "Arrastra tu " +
                    (fiscal ? "documento fiscal" : "ticket") +
                    " aquí"}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {fiscal
                  ? "XML, constancia PDF o imagen"
                  : "JPG, JPEG, PNG, WEBP o PDF"}{" "}
                · Máximo 10 MB
              </p>
            </div>
          )}
        </div>
      )}
      {file && !stream && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={upload}
            disabled={busy}
            className="disabled:opacity-50"
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {busy
              ? step
              : fiscal
                ? "Subir y revisar datos"
                : "Confirmar archivo y analizar"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setFile(null);
              setPreview("");
              if (input.current) input.current.value = "";
            }}
          >
            <RefreshCw className="size-4" />
            Elegir otro
          </Button>
          {!fiscal && (
            <Button variant="ghost" disabled={busy} onClick={camera}>
              Repetir foto
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <p role="status" className="text-xs leading-5 text-zinc-500">
        El gasto se registrará solo después de revisar y confirmar los datos. Si
        no hay OCR conectado, podrás capturarlos manualmente.
      </p>
    </div>
  );
}
