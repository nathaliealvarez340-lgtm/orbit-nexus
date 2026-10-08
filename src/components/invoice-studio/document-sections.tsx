import Link from "next/link";
import type {
  CreateInvoiceDraftRequest,
  InvoiceStudioClient,
  InvoiceStudioContext,
} from "@/types/invoice-studio";
import { CatalogCombobox } from "./catalog-combobox";
import { StudioField, StudioSection, StudioSelect } from "./fields";
import { catalogLabel } from "./model";

export type UpdateDraftField = <K extends keyof CreateInvoiceDraftRequest>(
  field: K,
  value: CreateInvoiceDraftRequest[K],
) => void;
export function DocumentSections({
  context,
  issuer,
  receiver,
  draft,
  folio,
  onChange,
  onClientChange,
  errorFor,
}: {
  context: InvoiceStudioContext;
  issuer: InvoiceStudioContext["issuer"];
  receiver?: InvoiceStudioClient;
  draft: CreateInvoiceDraftRequest;
  folio?: string | null;
  onChange: UpdateDraftField;
  onClientChange: (id: string) => void;
  errorFor: (field: string) => string | undefined;
}) {
  const clients = context.clients.map((client) => ({
    code: client.id,
    label: `${client.legalName} · ${client.rfc}`,
    active: true,
  }));
  if (receiver && !clients.some((option) => option.code === receiver.id))
    clients.push({
      code: receiver.id,
      label: `${receiver.legalName} · ${receiver.rfc} · Datos guardados`,
      active: false,
    });
  return (
    <>
      <StudioSection
        id="studio-issuer"
        step="01"
        title="Emisor"
        copy="Identidad fiscal de tu organización."
        action={
          <Link className="studio-link" href="/dashboard/fiscal-profile">
            Perfil fiscal
          </Link>
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">
              {issuer.legalName || "Razón social pendiente"}
            </p>
            <p className="mt-1 font-mono text-sm text-zinc-400">
              {issuer.rfc || "RFC pendiente"}
            </p>
          </div>
          <span
            className={
              issuer.profileComplete
                ? "studio-badge studio-success"
                : "studio-badge studio-warning"
            }
          >
            {issuer.profileComplete
              ? "Perfil completo"
              : "Perfil por completar"}
          </span>
        </div>
        <dl className="studio-identity mt-5">
          <div>
            <dt>Régimen fiscal</dt>
            <dd>
              {catalogLabel(
                context.catalogs.fiscalRegimes,
                issuer.fiscalRegime,
              )}
            </dd>
          </div>
          <div>
            <dt>Código postal fiscal</dt>
            <dd>{issuer.postalCode || "Pendiente"}</dd>
          </div>
          <div>
            <dt>Serie y folio</dt>
            <dd>
              {folio ?? `${context.settings.prefix} · Se asignará al guardar`}
            </dd>
          </div>
        </dl>
        {!issuer.profileComplete && (
          <p className="studio-notice mt-4">
            Completa tu perfil fiscal y adjunta la constancia. Puedes conservar
            tu captura como borrador; la revisión fiscal indicará los requisitos
            pendientes.
          </p>
        )}
        {!context.settings.logoAvailable && (
          <p className="studio-help mt-4">
            Logo pendiente.{" "}
            <Link className="studio-link" href="/dashboard/invoices/settings">
              Administrar facturas
            </Link>
          </p>
        )}
      </StudioSection>
      <StudioSection
        id="studio-receiver"
        step="02"
        title="Receptor"
        copy="Selecciona a quién vas a facturar."
        action={
          <Link className="studio-link" href="/dashboard/clients">
            Administrar clientes
          </Link>
        }
      >
        <CatalogCombobox
          label="Cliente receptor"
          showCode={false}
          field="clientId"
          value={draft.clientId}
          onChange={onClientChange}
          options={clients}
          error={errorFor("clientId")}
          help="Busca por nombre o RFC. Los datos fiscales provienen del cliente guardado."
        />
        {receiver ? (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[.02] p-4">
            <p className="font-medium">{receiver.legalName}</p>
            <p className="mt-1 font-mono text-sm text-zinc-400">
              {receiver.rfc}
            </p>
            <dl className="studio-identity mt-4">
              <div>
                <dt>Régimen fiscal</dt>
                <dd>
                  {catalogLabel(
                    context.catalogs.fiscalRegimes,
                    receiver.fiscalRegime,
                  )}
                </dd>
              </div>
              <div>
                <dt>Código postal fiscal</dt>
                <dd>{receiver.postalCode || "Pendiente"}</dd>
              </div>
              <div>
                <dt>Correo</dt>
                <dd>{receiver.email || "Sin correo registrado"}</dd>
              </div>
            </dl>
            {(!receiver.rfc ||
              !receiver.fiscalRegime ||
              !receiver.postalCode) && (
              <p className="studio-warning mt-3 text-sm">
                El cliente tiene datos fiscales pendientes. Complétalos en
                Clientes antes de la revisión final.
              </p>
            )}
          </div>
        ) : (
          <p className="studio-help mt-3">
            Selecciona un cliente para consultar su identidad fiscal y sus
            valores predeterminados.
          </p>
        )}
        {!clients.length && (
          <p className="studio-warning mt-3 text-sm">
            Todavía no tienes clientes. Puedes crearlos desde Administrar
            clientes.
          </p>
        )}
      </StudioSection>
      <StudioSection
        id="studio-document"
        step="03"
        title="Datos del comprobante"
        copy="Fecha, moneda y alcance del documento."
      >
        <div className="studio-field-grid">
          <StudioField
            label="Fecha"
            type="date"
            field="invoiceDate"
            value={draft.invoiceDate}
            onChange={(value) => onChange("invoiceDate", value)}
            error={errorFor("invoiceDate")}
          />
          <StudioSelect
            label="Tipo de comprobante"
            field="documentType"
            value={draft.documentType}
            options={context.catalogs.documentTypes.map((option) => ({
              ...option,
              active: option.active && option.code === "I",
              label:
                option.code === "I"
                  ? option.label
                  : option.label + " · Próximamente",
            }))}
            onChange={(value) =>
              onChange(
                "documentType",
                value as CreateInvoiceDraftRequest["documentType"],
              )
            }
            error={errorFor("documentType")}
            help="Ingreso es el tipo disponible para revisión fiscal en esta fase."
          />
          <StudioSelect
            label="Moneda"
            field="currency"
            options={context.catalogs.currencies}
            value={draft.currency}
            onChange={(value) => onChange("currency", value)}
            error={errorFor("currency")}
          />
          {draft.currency && draft.currency !== "MXN" && (
            <StudioField
              label="Tipo de cambio"
              field="exchangeRate"
              inputMode="decimal"
              value={draft.exchangeRate}
              onChange={(value) => onChange("exchangeRate", value)}
              error={errorFor("exchangeRate")}
            />
          )}
          <StudioSelect
            label="Exportación"
            field="exportCode"
            options={context.catalogs.exportCodes}
            value={draft.exportCode}
            onChange={(value) => onChange("exportCode", value)}
            error={errorFor("exportCode")}
          />
          <CatalogCombobox
            label="Uso CFDI"
            field="cfdiUse"
            options={context.catalogs.cfdiUses}
            value={draft.cfdiUse}
            onChange={(value) => onChange("cfdiUse", value)}
            error={errorFor("cfdiUse")}
            help={
              receiver?.cfdiUse
                ? `Predeterminado del cliente: ${catalogLabel(context.catalogs.cfdiUses, receiver.cfdiUse)}.`
                : "Selecciona el uso del documento."
            }
          />
        </div>
      </StudioSection>
      <StudioSection
        id="studio-payment"
        step="04"
        title="Datos de pago"
        copy="Define cómo se liquida esta factura."
      >
        <div className="studio-field-grid">
          <StudioSelect
            label="Método de pago"
            field="paymentMethod"
            options={context.catalogs.paymentMethods}
            value={draft.paymentMethod}
            onChange={(value) => {
              onChange(
                "paymentMethod",
                value ? (value as "PUE" | "PPD") : undefined,
              );
            }}
            error={errorFor("paymentMethod")}
          />
          <CatalogCombobox
            label="Forma de pago"
            field="paymentForm"
            options={context.catalogs.paymentForms}
            value={draft.paymentForm}
            onChange={(value) => onChange("paymentForm", value)}
            error={errorFor("paymentForm")}
            help={
              receiver?.defaultPaymentForm
                ? `Predeterminado del cliente: ${catalogLabel(context.catalogs.paymentForms, receiver.defaultPaymentForm)}.`
                : "Elige la forma de pago; no se asigna automáticamente."
            }
          />
        </div>
        {draft.paymentMethod === "PPD" && draft.paymentForm !== "99" && (
          <div className="studio-notice mt-4">
            <p>
              Para pago en parcialidades o diferido, utiliza la forma de pago 99
              · Por definir.
            </p>
            <button
              type="button"
              className="studio-link mt-2"
              onClick={() => onChange("paymentForm", "99")}
            >
              Usar forma de pago 99
            </button>
          </div>
        )}
      </StudioSection>
    </>
  );
}
