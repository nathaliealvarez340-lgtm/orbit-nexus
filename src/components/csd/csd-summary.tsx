"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CsdState } from "@/types/csd";
import { CsdStatusCard } from "./csd-status";
import { csdTransport, CsdUiError } from "./transport";
import "./csd.css";
export function CsdSummary() {
  const [state, setState] = useState<CsdState>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    csdTransport
      .state(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setState(value);
          setError("");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setState(undefined);
          setError(
            cause instanceof CsdUiError && cause.status === 403
              ? "El CSD lo administra un propietario o administrador."
              : "No pudimos consultar el estado del CSD.",
          );
        }
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <div className="csd-ui">
      {state ? (
        <CsdStatusCard state={state} compact />
      ) : (
        <p role="status" className="csd-help">
          {error || "Consultando estado del CSD…"}
        </p>
      )}
      <div className="csd-actions">
        <Link className="csd-link" href="/dashboard/stamping">
          Administrar CSD
        </Link>
        {error === "No pudimos consultar el estado del CSD." && (
          <button
            className="csd-link"
            type="button"
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            Volver a consultar
          </button>
        )}
      </div>
    </div>
  );
}
