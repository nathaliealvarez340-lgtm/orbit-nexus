import type { CsdState, CsdHistoryItem, CsdInvalidReason } from "@/types/csd";
import type { ReactNode } from "react";
import { ShieldCheck, ShieldAlert, CircleMinus } from "lucide-react";

export const csdStatusLabels: Record<CsdState["status"], string> = {
  NOT_CONFIGURED: "Sin CSD configurado",
  VALIDATING: "Validando CSD…",
  VALID: "CSD configurado y válido",
  EXPIRED: "El certificado está vencido",
  INVALID: "El CSD requiere atención",
};
const invalidMessages: Record<CsdInvalidReason, string> = {
  NOT_YET_VALID: "El certificado todavía no está vigente.",
  RFC_CHANGED:
    "El RFC del Perfil Fiscal cambió y ya no corresponde a este certificado.",
  KEY_UNAVAILABLE:
    "La custodia de esta llave no está disponible. No puede utilizarse para sellar.",
  INTEGRITY:
    "No pudimos verificar la integridad de la llave. No puede utilizarse para sellar.",
};
export function csdDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(value)) + " UTC"
    : "No disponible";
}
export function CsdStatusCard({
  state,
  compact = false,
}: {
  state: CsdState;
  compact?: boolean;
}) {
  const Icon =
    state.status === "VALID"
      ? ShieldCheck
      : state.status === "NOT_CONFIGURED"
        ? CircleMinus
        : ShieldAlert;
  return (
    <section className="surface csd-status" aria-label="Estado del CSD">
      <div className="csd-status-heading">
        <h2>
          <Icon aria-hidden="true" className="size-5" />
          {csdStatusLabels[state.status]}
        </h2>
        {state.environment && (
          <span className="csd-badge">
            {state.environment === "SANDBOX"
              ? "SANDBOX · Prueba"
              : "PRODUCTION"}
          </span>
        )}
      </div>
      {!state.serviceAvailable && (
        <p className="csd-warning">
          La custodia de CSD no está disponible en este entorno.
        </p>
      )}
      {state.invalidReason && (
        <p className="csd-warning">{invalidMessages[state.invalidReason]}</p>
      )}
      {state.status === "EXPIRED" && (
        <p className="csd-warning">
          Este certificado no permite sellar. Sustitúyelo o deshabilítalo.
        </p>
      )}
      {state.expiresSoon && (
        <p className="csd-warning">
          El certificado vence en 30 días o menos. Revisa su vigencia y prepara
          la sustitución.
        </p>
      )}
      {state.id && (
        <dl className="csd-metadata">
          {!compact && (
            <>
              <div>
                <dt>RFC</dt>
                <dd>{state.rfc}</dd>
              </div>
              <div>
                <dt>Número de certificado</dt>
                <dd>{state.certificateNumber}</dd>
              </div>
              <div>
                <dt>Vigente desde</dt>
                <dd>{csdDate(state.validFrom)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Vigente hasta</dt>
            <dd>{csdDate(state.validTo)}</dd>
          </div>
          {!compact && (
            <div>
              <dt>Última actualización</dt>
              <dd>{csdDate(state.updatedAt)}</dd>
            </div>
          )}
        </dl>
      )}
      {!compact && state.verification?.csdTypeVerifiedLocally === false && (
        <p className="csd-help">
          ORBIT no pudo demostrar localmente que el certificado sea CSD frente a
          e.firma. La confirmación final corresponde al SAT y al PAC; no subas
          tu e.firma.
        </p>
      )}
      <p className="csd-help">
        Configurar el CSD no emite ni autoriza ninguna factura. El timbrado
        sigue pendiente de configuración.
      </p>
    </section>
  );
}
export function CsdHistory({ items }: { items: CsdHistoryItem[] }) {
  const labels = {
    ACTIVE: "Configurado",
    REPLACED: "Sustituido",
    DISABLED: "Deshabilitado",
  };
  return (
    <section
      className="surface csd-history"
      aria-labelledby="csd-history-title"
    >
      <h2 id="csd-history-title">Historial del CSD</h2>
      <p className="csd-help">
        Últimos 50 certificados. Los registros retirados conservan metadata; su
        llave cifrada fue eliminada.
      </p>
      {!items.length ? (
        <p className="csd-help">Aún no hay certificados registrados.</p>
      ) : (
        <table
          className="csd-history-table"
          role="table"
          aria-labelledby="csd-history-title"
        >
          <caption className="sr-only">
            Historial de certificados configurados, sustituidos y deshabilitados
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              {[
                "Número de certificado",
                "RFC",
                "Ambiente",
                "Vigencia",
                "Estado",
                "Configurado por",
                "Fechas",
              ].map((label) => (
                <th key={label} role="columnheader" scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {items.map((item) => (
              <tr role="row" key={item.id}>
                <HistoryCell label="Número de certificado">
                  {item.certificateNumber}
                </HistoryCell>
                <HistoryCell label="RFC">{item.rfc}</HistoryCell>
                <HistoryCell label="Ambiente">{item.environment}</HistoryCell>
                <HistoryCell label="Vigencia">
                  {csdDate(item.validFrom)} — {csdDate(item.validTo)}
                </HistoryCell>
                <HistoryCell label="Estado">{labels[item.status]}</HistoryCell>
                <HistoryCell label="Configurado por">
                  {item.configuredBy ?? "No disponible"}
                </HistoryCell>
                <HistoryCell label="Fechas">
                  Configurado: {csdDate(item.configuredAt)}
                  {item.endedAt && (
                    <>
                      <br />
                      Retirado: {csdDate(item.endedAt)}
                    </>
                  )}
                </HistoryCell>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
function HistoryCell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <td role="cell">
      <span aria-hidden="true" className="csd-cell-label">
        {label}
      </span>
      <span>{children}</span>
    </td>
  );
}
