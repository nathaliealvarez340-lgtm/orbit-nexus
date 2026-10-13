import type { Cfdi40Catalogs } from "./catalogs";
import {
  CfdiDecimal,
  atLeast,
  canonical,
  decimalsOf,
  fixed,
  parseAmount,
  round,
  sum,
} from "./decimal";
import { cfdi40Issue, type Cfdi40Issue } from "./errors";
import { localIssueDateTime } from "./issue-date";
import type {
  Cfdi40Concept,
  Cfdi40ConceptInput,
  Cfdi40Document,
  Cfdi40DraftInput,
  Cfdi40Taxes,
  Cfdi40Transfer,
  Cfdi40TransferSummary,
  Cfdi40Withholding,
} from "./types";

// Fase 5C.4: CFDI draft input → computed Cfdi40Document, or the list of issues.
// - Scope (v1): Ingreso only; anything else fails explicitly (UNSUPPORTED).
// - Text: Unicode NFC, then the XSD whiteSpace="collapse" rule applied by ORBIT itself so
//   the XML and the future cadena original carry the same value; "|" and characters XML
//   does not allow are rejected, never replaced.
// - Amounts: exact decimals. Each concept field is rounded once to the currency decimals
//   (Importe = Cantidad × ValorUnitario, impuestos = Base × TasaOCuota); comprobante values
//   are the rounded sums (Anexo 20; guía de llenado, preguntas 37 y 39).
// - Every computed amount must equal what ORBIT persisted for the draft; a difference is
//   an error, never silently corrected.

export const genericRfc = {
  national: "XAXX010101000",
  foreign: "XEXX010101000",
} as const;
/** Codes the error matrix ties to a complement (CFDI40228); not flagged in c_ClaveProdServ. */
export const productsRequiringComplement = new Set([
  "15101505",
  "15101514",
  "15101515",
]);
export const supportedTaxObjects = new Set(["01", "02", "03", "04"]);
export const borderVatRate = "0.080000";
/** c_ClaveProdServ "No existe en el catálogo"; also the Fase 3 migration default. */
export const genericProductCode = "01010101";

export type NormalizeContext = {
  /** Server instant of emission; the CFDI Fecha is derived from it. */
  issuedAt: Date;
  catalogs: Cfdi40Catalogs;
  /**
   * EMISSION (default): every rule, as when the CFDI is about to be sealed.
   * CONTENT: the READY gate. Same rules except the two that depend on the moment of
   * emission and on the transition itself: status READY and the draft date matching the
   * local issue date. Catalog validity and the time zone are evaluated at `issuedAt`.
   */
  mode?: "EMISSION" | "CONTENT";
};
export type NormalizeResult =
  | { ok: true; document: Cfdi40Document; issueDate: string }
  | { ok: false; issues: Cfdi40Issue[] };

// XML 1.0 characters minus C0/C1 controls (tab, CR and LF become spaces when collapsed) and
// U+2028/U+2029: some parsers (the approved xmldom) treat them as line ends and others do
// not, so the cadena original would depend on the parser (Fase 5C.5).
const allowedCharacters =
  /^[\t\n\r\u0020-\u007E\u00A0-\u2027\u202A-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]*$/u;

export const plainName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

export function normalizeCfdi40(
  input: Cfdi40DraftInput,
  context: NormalizeContext,
): NormalizeResult {
  const issues: Cfdi40Issue[] = [];
  const add = (...args: Parameters<typeof cfdi40Issue>) =>
    issues.push(cfdi40Issue(...args));
  const fail = (): NormalizeResult => ({ ok: false, issues });
  const { catalogs } = context;

  const textValue = (
    raw: string | null,
    path: string,
    rule: string,
    max: number,
  ) => {
    if (raw === null) {
      add("TEXT_REQUIRED", path, rule);
      return "";
    }
    const value = raw.normalize("NFC");
    if (!allowedCharacters.test(value)) {
      add("TEXT_INVALID_CHARACTER", path, rule);
      return "";
    }
    const collapsed = value.replace(/[\t\n\r ]+/g, " ").trim();
    if (!collapsed) add("TEXT_REQUIRED", path, rule);
    else if (collapsed.includes("|")) add("TEXT_PIPE_NOT_ALLOWED", path, rule);
    else if ([...collapsed].length > max) add("TEXT_TOO_LONG", path, rule);
    return collapsed;
  };

  // --- Scope -----------------------------------------------------------------------------
  const emission = (context.mode ?? "EMISSION") === "EMISSION";
  if (emission && input.status !== "READY")
    add("INVOICE_NOT_READY", "Comprobante", "ORBIT");
  // Values written by migrations are never taken as choices of the user.
  if (input.legacyRecord)
    add("LEGACY_RECORD_REVIEW_REQUIRED", "Comprobante", "ORBIT");
  if (input.documentType !== "I")
    add("DOCUMENT_TYPE_UNSUPPORTED", "Comprobante/@TipoDeComprobante", "ORBIT");
  if (input.relatedDocuments.length)
    add("RELATED_CFDI_UNSUPPORTED", "Comprobante/CfdiRelacionados", "ORBIT");
  if (!input.exportCode)
    add("EXPORT_CODE_MISSING", "Comprobante/@Exportacion", "ORBIT");
  else if (input.exportCode !== "01")
    add("EXPORT_UNSUPPORTED", "Comprobante/@Exportacion", "ORBIT");
  const currency = catalogs.currency(input.currency);
  if (!currency)
    add("CATALOG_CODE_UNKNOWN", "Comprobante/@Moneda", "CFDI40113");
  else if (input.currency === "XXX" || currency.decimals !== 2)
    add("CURRENCY_UNSUPPORTED", "Comprobante/@Moneda", "ORBIT");
  if (input.receiver.rfc === genericRfc.foreign)
    add("FOREIGN_RECEIVER_UNSUPPORTED", "Comprobante/Receptor/@Rfc", "ORBIT");
  if (
    input.receiver.rfc === genericRfc.national &&
    input.receiver.name !== null &&
    plainName(input.receiver.name) === "PUBLICO EN GENERAL"
  )
    add(
      "GLOBAL_INVOICE_UNSUPPORTED",
      "Comprobante/InformacionGlobal",
      "CFDI40130",
    );
  if (issues.length) return fail();
  const places = currency!.decimals;

  // --- Required ORBIT data ---------------------------------------------------------------
  const issuerKeys = [
    "rfc",
    "name",
    "personType",
    "fiscalRegime",
    "postalCode",
  ] as const;
  if (issuerKeys.some((k) => input.issuer[k] === null))
    add("ISSUER_DATA_MISSING", "Comprobante/Emisor", "ORBIT");
  if (issuerKeys.some((k) => input.receiver[k] === null))
    add("RECEIVER_DATA_MISSING", "Comprobante/Receptor", "ORBIT");
  if (!input.receiver.cfdiUse)
    add("CFDI_USE_MISSING", "Comprobante/Receptor/@UsoCFDI", "ORBIT");
  if (!input.paymentMethod)
    add("PAYMENT_METHOD_MISSING", "Comprobante/@MetodoPago", "ORBIT");
  if (!input.paymentForm)
    add("PAYMENT_FORM_MISSING", "Comprobante/@FormaPago", "ORBIT");
  if (!input.concepts.length)
    add("CONCEPTS_MISSING", "Comprobante/Conceptos", "ORBIT");
  if (issues.length) return fail();

  // --- Fecha and LugarExpedicion ---------------------------------------------------------
  const placeOfIssue = input.issuer.postalCode!;
  const postal = catalogs.postalCode(placeOfIssue);
  let issueDate = "";
  let issuedAt = "";
  // No fallback: an unknown postal code or zone never becomes CDMX or any other zone.
  if (!postal)
    add("PLACE_OF_ISSUE_UNKNOWN", "Comprobante/@LugarExpedicion", "CFDI40126");
  else if (Number.isNaN(context.issuedAt.getTime()))
    add("ISSUE_TIME_INVALID", "Comprobante/@Fecha", "ORBIT");
  else {
    const local = localIssueDateTime(context.issuedAt, postal.timeZone);
    if (!local)
      add("ISSUE_TIME_ZONE_UNRESOLVED", "Comprobante/@Fecha", "CFDI40101");
    else {
      issuedAt = local.issuedAt;
      issueDate = local.date;
      if (emission && input.draftDate !== local.date)
        add("ISSUE_DATE_DIFFERS_FROM_DRAFT", "Comprobante/@Fecha", "ORBIT");
    }
  }

  // --- Text ------------------------------------------------------------------------------
  const folio =
    input.folio === null
      ? null
      : textValue(input.folio, "Comprobante/@Folio", "XSD:Folio", 40);
  const issuerName = textValue(
    input.issuer.name,
    "Comprobante/Emisor/@Nombre",
    "XSD:Nombre",
    300,
  );
  const receiverName = textValue(
    input.receiver.name,
    "Comprobante/Receptor/@Nombre",
    "XSD:Nombre",
    300,
  );

  // --- TipoCambio ------------------------------------------------------------------------
  let exchangeRate: string | null = null;
  if (input.currency === "MXN") {
    if (
      input.exchangeRate !== null &&
      canonicalText(input.exchangeRate) !== "1"
    )
      add("EXCHANGE_RATE_NOT_ALLOWED", "Comprobante/@TipoCambio", "CFDI40114");
  } else if (input.exchangeRate === null)
    add("EXCHANGE_RATE_MISSING", "Comprobante/@TipoCambio", "CFDI40115");
  else {
    const rate = parseAmount(input.exchangeRate, 6);
    if (!rate || rate.isZero())
      add("AMOUNT_INVALID", "Comprobante/@TipoCambio", "CFDI40117");
    else exchangeRate = canonical(rate);
  }

  // --- Concepts --------------------------------------------------------------------------
  type Computed = {
    concept: Cfdi40Concept;
    amount: CfdiDecimal;
    discount: CfdiDecimal;
    transfers: {
      transfer: Cfdi40Transfer;
      base: CfdiDecimal;
      amount: CfdiDecimal;
    }[];
    withholdings: { withholding: Cfdi40Withholding; amount: CfdiDecimal }[];
  };
  const computed: Computed[] = [];
  for (const c of input.concepts) {
    const result = normalizeConcept(c, places, textValue, add);
    if (result) computed.push(result);
  }
  if (issues.length) return fail();

  // --- Comprobante totals and tax summary -----------------------------------------------
  const subtotal = round(sum(computed.map((c) => c.amount)), places);
  const anyDiscount = computed.some((c) => c.concept.discount !== null);
  const discount = round(sum(computed.map((c) => c.discount)), places);

  const transferGroups = new Map<
    string,
    { sample: Cfdi40Transfer; bases: CfdiDecimal[]; amounts: CfdiDecimal[] }
  >();
  for (const c of computed)
    for (const t of c.transfers) {
      const key = `${t.transfer.tax}|${t.transfer.factor}|${t.transfer.rate ?? ""}`;
      const group = transferGroups.get(key) ?? {
        sample: t.transfer,
        bases: [],
        amounts: [],
      };
      group.bases.push(t.base);
      group.amounts.push(t.amount);
      transferGroups.set(key, group);
    }
  const factorOrder = { Tasa: 0, Cuota: 1, Exento: 2 } as const;
  const transfers: Cfdi40TransferSummary[] = [...transferGroups.values()]
    .sort(
      (a, b) =>
        a.sample.tax.localeCompare(b.sample.tax) ||
        factorOrder[a.sample.factor] - factorOrder[b.sample.factor] ||
        new CfdiDecimal(b.sample.rate ?? 0).comparedTo(a.sample.rate ?? 0),
    )
    .map((g) =>
      g.sample.factor === "Exento"
        ? {
            base: fixed(round(sum(g.bases), places), places),
            tax: g.sample.tax,
            factor: "Exento",
            rate: null,
            amount: null,
          }
        : {
            base: fixed(round(sum(g.bases), places), places),
            tax: g.sample.tax,
            factor: "Tasa",
            rate: g.sample.rate,
            amount: fixed(round(sum(g.amounts), places), places),
          },
    );
  const withholdingTaxes = [
    ...new Set(
      computed.flatMap((c) => c.withholdings.map((w) => w.withholding.tax)),
    ),
  ].sort();
  const withholdings = withholdingTaxes.map((tax) => ({
    tax,
    amount: fixed(
      round(
        sum(
          computed.flatMap((c) =>
            c.withholdings
              .filter((w) => w.withholding.tax === tax)
              .map((w) => w.amount),
          ),
        ),
        places,
      ),
      places,
    ),
  }));
  const taxedTransfers = transfers.filter((t) => t.factor !== "Exento");
  const totalTransferred = sum(
    taxedTransfers.map((t) => new CfdiDecimal(t.amount!)),
  );
  const totalWithheld = sum(withholdings.map((w) => new CfdiDecimal(w.amount)));
  const taxes: Cfdi40Taxes | null =
    transfers.length || withholdings.length
      ? {
          totalWithheld: withholdings.length
            ? fixed(totalWithheld, places)
            : null,
          totalTransferred: taxedTransfers.length
            ? fixed(totalTransferred, places)
            : null,
          withholdings,
          transfers,
        }
      : null;
  const total = subtotal
    .sub(anyDiscount ? discount : 0)
    .add(totalTransferred)
    .sub(totalWithheld);
  if (total.isNegative())
    add("TOTAL_NEGATIVE", "Comprobante/@Total", "XSD:Total");

  // --- Reconcile with what ORBIT persisted ------------------------------------------------
  const vatWithheld = sum(
    computed.flatMap((c) =>
      c.withholdings
        .filter((w) => w.withholding.tax === "002")
        .map((w) => w.amount),
    ),
  );
  const isrWithheld = sum(
    computed.flatMap((c) =>
      c.withholdings
        .filter((w) => w.withholding.tax === "001")
        .map((w) => w.amount),
    ),
  );
  const orbit = input.orbitTotals;
  const persisted: [string, CfdiDecimal][] = [
    [orbit.subtotal, subtotal],
    [orbit.discount, anyDiscount ? discount : new CfdiDecimal(0)],
    [orbit.transferred, totalTransferred],
    [orbit.withheldVat, vatWithheld],
    [orbit.withheldIsr, isrWithheld],
    [orbit.total, total],
  ];
  if (persisted.some(([stored, value]) => !sameAmount(stored, value)))
    add("ORBIT_TOTALS_MISMATCH", "Comprobante", "ORBIT");
  if (issues.length) return fail();

  return {
    ok: true,
    issueDate,
    document: {
      version: "4.0",
      serie: input.serie,
      folio,
      issuedAt,
      paymentForm: input.paymentForm!,
      paymentMethod: input.paymentMethod!,
      subtotal: fixed(subtotal, places),
      discount: anyDiscount ? fixed(discount, places) : null,
      currency: input.currency,
      exchangeRate,
      total: fixed(total, places),
      documentType: "I",
      exportCode: input.exportCode,
      placeOfIssue,
      issuer: {
        rfc: input.issuer.rfc!,
        name: issuerName,
        fiscalRegime: input.issuer.fiscalRegime!,
      },
      receiver: {
        rfc: input.receiver.rfc!,
        name: receiverName,
        fiscalAddressPostalCode: input.receiver.postalCode!,
        fiscalRegime: input.receiver.fiscalRegime!,
        cfdiUse: input.receiver.cfdiUse!,
      },
      concepts: computed.map((c) => c.concept),
      taxes,
    },
  };
}

const canonicalText = (value: string) => {
  const parsed = parseAmount(value, 6);
  return parsed ? canonical(parsed) : value;
};
const sameAmount = (stored: string, value: CfdiDecimal) => {
  const parsed = parseAmount(stored, 6);
  return !!parsed && parsed.equals(value);
};

type TextValue = (
  raw: string | null,
  path: string,
  rule: string,
  max: number,
) => string;
type Add = (...args: Parameters<typeof cfdi40Issue>) => void;

function normalizeConcept(
  c: Cfdi40ConceptInput,
  places: number,
  textValue: TextValue,
  add: Add,
) {
  const at = `Comprobante/Conceptos/Concepto[${c.index + 1}]`;
  const before = { count: 0 };
  const track: Add = (...args) => {
    before.count++;
    add(...args);
  };
  const description = textValue(
    c.description,
    at + "/@Descripcion",
    "XSD:Descripcion",
    1000,
  );
  const quantity = parseAmount(c.quantity, 6);
  if (!quantity) track("AMOUNT_INVALID", at + "/@Cantidad", "XSD:Cantidad");
  else if (quantity.isZero())
    track("QUANTITY_NOT_POSITIVE", at + "/@Cantidad", "XSD:Cantidad");
  const unitPrice = parseAmount(c.unitPrice, 6);
  if (!unitPrice)
    track("AMOUNT_INVALID", at + "/@ValorUnitario", "XSD:ValorUnitario");
  else if (unitPrice.isZero())
    track("UNIT_PRICE_NOT_POSITIVE", at + "/@ValorUnitario", "CFDI40166");
  const discount = parseAmount(c.discount, 6);
  if (!discount) track("AMOUNT_INVALID", at + "/@Descuento", "XSD:Descuento");
  else if (decimalsOf(canonical(discount)) > places)
    track("DISCOUNT_DECIMALS_EXCEED_AMOUNT", at + "/@Descuento", "CFDI40168");
  if (!c.taxObject) track("TAX_OBJECT_MISSING", at + "/@ObjetoImp", "ORBIT");
  else if (!supportedTaxObjects.has(c.taxObject))
    track("TAX_OBJECT_UNSUPPORTED", at + "/@ObjetoImp", "ORBIT");
  if (!quantity || !unitPrice || !discount || before.count) return null;

  const amount = round(quantity.mul(unitPrice), places);
  if (discount.greaterThan(amount)) {
    track("DISCOUNT_EXCEEDS_AMOUNT", at + "/@Descuento", "CFDI40169");
    return null;
  }
  const base = amount.sub(discount);
  const transfers: {
    transfer: Cfdi40Transfer;
    base: CfdiDecimal;
    amount: CfdiDecimal;
  }[] = [];
  const withholdings: {
    withholding: Cfdi40Withholding;
    amount: CfdiDecimal;
  }[] = [];
  const withholdingRates: [string, string | null][] = [
    ["001", c.withholdingIsrRate],
    ["002", c.withholdingVatRate],
  ];
  if (c.taxObject !== "02") {
    if (c.vat.rate !== null || withholdingRates.some(([, r]) => r !== null))
      track("TAX_OBJECT_FORBIDS_TAXES", at + "/Impuestos", "CFDI40172");
  } else {
    if (!base.greaterThan(0))
      track("TAX_BASE_NOT_POSITIVE", at + "/Impuestos", "CFDI40174");
    const baseText = fixed(base, places);
    if (c.vat.factor === "Exento") {
      if (c.vat.rate !== null)
        track("EXEMPT_WITH_RATE", at + "/Impuestos/Traslados", "CFDI40177");
      else
        transfers.push({
          transfer: {
            base: baseText,
            tax: "002",
            factor: "Exento",
            rate: null,
            amount: null,
          },
          base,
          amount: new CfdiDecimal(0),
        });
    } else if (c.vat.rate === null)
      track("CONCEPT_VAT_MISSING", at + "/Impuestos/Traslados", "CFDI40171");
    else {
      const rate = parseAmount(c.vat.rate, 6);
      if (!rate)
        track(
          "AMOUNT_INVALID",
          at + "/Impuestos/Traslados/Traslado/@TasaOCuota",
          "XSD:TasaOCuota",
        );
      else if (fixed(rate, 6) === borderVatRate)
        track(
          "VAT_BORDER_RATE_UNSUPPORTED",
          at + "/Impuestos/Traslados/Traslado/@TasaOCuota",
          "ORBIT",
        );
      else {
        const value = round(base.mul(rate), places);
        transfers.push({
          transfer: {
            base: baseText,
            tax: "002",
            factor: "Tasa",
            rate: fixed(rate, 6),
            amount: fixed(value, places),
          },
          base,
          amount: value,
        });
      }
    }
    for (const [tax, text] of withholdingRates) {
      if (text === null) continue;
      const rate = parseAmount(text, 6);
      if (!rate || rate.isZero()) {
        track(
          "AMOUNT_INVALID",
          at + "/Impuestos/Retenciones/Retencion/@TasaOCuota",
          "ORBIT",
        );
        continue;
      }
      const value = round(base.mul(rate), places);
      withholdings.push({
        withholding: {
          base: baseText,
          tax,
          factor: "Tasa",
          rate: fixed(rate, 6),
          amount: fixed(value, places),
        },
        amount: value,
      });
    }
  }
  if (before.count) return null;

  // Reconcile the line with ORBIT's persisted values.
  const transferred = sum(transfers.map((t) => t.amount));
  const withheld = (tax: string) =>
    sum(
      withholdings
        .filter((w) => w.withholding.tax === tax)
        .map((w) => w.amount),
    );
  const applied =
    c.taxObject === "02" && c.vat.factor === "Tasa" && c.vat.rate !== null
      ? new CfdiDecimal(c.vat.rate)
      : new CfdiDecimal(0);
  const checks: [string, CfdiDecimal][] = [
    [c.orbit.amount, amount],
    [c.orbit.discount, discount],
    [c.orbit.transferred, transferred],
    [c.orbit.withheldVat, withheld("002")],
    [c.orbit.withheldIsr, withheld("001")],
    [c.orbit.appliedVatRate, applied],
  ];
  if (checks.some(([stored, value]) => !sameAmount(stored, value))) {
    track("ORBIT_TOTALS_MISMATCH", at, "ORBIT");
    return null;
  }

  const concept: Cfdi40Concept = {
    productCode: c.productCode,
    quantity: canonical(quantity),
    unitCode: c.unitCode,
    description,
    unitPrice: atLeast(unitPrice, places),
    amount: fixed(amount, places),
    discount: discount.isZero() ? null : fixed(discount, places),
    taxObject: c.taxObject,
    taxes:
      c.taxObject === "02"
        ? {
            transfers: transfers.map((t) => t.transfer),
            withholdings: withholdings.map((w) => w.withholding),
          }
        : null,
  };
  return { concept, amount, discount, transfers, withholdings };
}
