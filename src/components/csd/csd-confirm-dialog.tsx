"use client";
import { useEffect, useId, useRef } from "react";
import { usePrivacyLayer } from "@/components/privacy/privacy-layer";
import { Button } from "@/components/ui/button";
export function CsdConfirmDialog({
  action,
  certificateNumber,
  onConfirm,
  onClose,
}: {
  action: "replace" | "disable";
  certificateNumber: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId(),
    description = useId();
  const setHost = usePrivacyLayer()?.setHost;
  useEffect(() => {
    const element = dialog.current,
      opener = document.activeElement as HTMLElement | null;
    element?.showModal();
    setHost?.(element);
    return () => {
      element?.close();
      setHost?.(null);
      opener?.focus();
    };
  }, [setHost]);
  return (
    <dialog
      ref={dialog}
      className="csd-dialog"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={title}>
        {action === "replace"
          ? "Confirmar sustitución del CSD"
          : "Confirmar deshabilitación del CSD"}
      </h2>
      <p className="csd-help">Certificado: {certificateNumber}</p>
      <p id={description} className="csd-warning">
        {action === "replace"
          ? "Cuando el nuevo CSD se valide y la sustitución se confirme, la llave privada cifrada anterior se eliminará. Solo se conservará la metadata del certificado anterior."
          : "Deshabilitar elimina la llave privada cifrada. No es una pausa temporal: para volver a configurarlo necesitarás cargar de nuevo los archivos y su contraseña."}
      </p>
      <p className="csd-help">
        Los respaldos pueden conservar datos hasta su expiración según la
        política de retención. Esta acción no emite facturas.
      </p>
      <div className="csd-actions">
        <Button variant="secondary" autoFocus onClick={onClose}>
          Cancelar
        </Button>
        <Button
          className={action === "disable" ? "csd-destructive" : ""}
          onClick={onConfirm}
        >
          {action === "replace"
            ? "Continuar con la sustitución"
            : "Confirmar deshabilitación"}
        </Button>
      </div>
    </dialog>
  );
}
