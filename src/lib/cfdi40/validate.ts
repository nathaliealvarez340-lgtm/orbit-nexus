import {
  inForce,
  type Cfdi40Catalogs,
  type PersonType,
  type Validity,
} from "./catalogs";
import {
  CfdiDecimal,
  conceptAmountWithinLimits,
  decimalsOf,
  round,
  sum,
  taxAmountWithinLimits,
} from "./decimal";
import { cfdi40Issue, type Cfdi40Issue } from "./errors";
import {
  borderVatRate,
  genericProductCode,
  genericRfc,
  productsRequiringComplement,
  supportedTaxObjects,
} from "./normalize";
import type { Cfdi40Document } from "./types";

// Fase 5C.4: independent checks of a computed Cfdi40Document (defense in depth: it does not
// trust the normalizer). Sources, cited in each issue: the official error matrix
// (CFDI40xxx), the cfdv40/tdCFDI facets (XSD:<attribute>), the Anexo 20 limit formulas and
// ORBIT policy, which is stricter (e.g. amounts must be the exact rounding, not merely
// inside the SAT tolerance). Catalog validity is evaluated on the local issue date.
// This is NOT XSD validation; see ./schema.ts.

const pattern = {
  rfc: /^[A-Z&Ñ]{3,4}[0-9]{2}(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[0-9A]$/,
  fechaH:
    /^(20[1-9][0-9])-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T(([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9])$/,
  importe: /^[0-9]{1,18}(\.[0-9]{1,6})?$/,
  postalCode: /^[0-9]{5}$/,
  rate: /^[0-9]+\.[0-9]{6}$/,
  text: (max: number) => new RegExp(`^[^|]{1,${max}}$`, "u"),
};
const dec = (value: string) => new CfdiDecimal(value);

export function validateCfdi40(
  doc: Cfdi40Document,
  catalogs: Cfdi40Catalogs,
): Cfdi40Issue[] {
  const issues: Cfdi40Issue[] = [];
  const add = (...args: Parameters<typeof cfdi40Issue>) =>
    issues.push(cfdi40Issue(...args));
  const date = doc.issuedAt.slice(0, 10);
  const root = "Comprobante";

  // Catalog membership and validity on the issue date.
  const catalog = <T extends Validity>(
    lookup: (code: string) => T | undefined,
    code: string,
    path: string,
    rule: string,
  ): T | undefined => {
    const entry = lookup(code);
    if (!entry) add("CATALOG_CODE_UNKNOWN", path, rule);
    else if (!inForce(entry, date))
      add("CATALOG_CODE_NOT_IN_FORCE", path, rule);
    return entry && inForce(entry, date) ? entry : undefined;
  };
  // Codes enumerated by catCFDI.xsd but absent from the official xls have no validity
  // data: they cannot be verified, which is different from an unknown code.
  const xsdAware = <T extends Validity>(
    lookup: (code: string) => T | undefined,
    xsdOnly: (code: string) => boolean,
    code: string,
    path: string,
    rule: string,
  ) => {
    if (!lookup(code) && xsdOnly(code)) {
      add("CATALOG_CODE_UNVERIFIABLE", path, rule);
      return undefined;
    }
    return catalog(lookup, code, path, rule);
  };
  const text = (
    value: string | null,
    max: number,
    path: string,
    rule: string,
  ) => {
    if (value !== null && !pattern.text(max).test(value))
      add("VALUE_PATTERN_MISMATCH", path, rule);
  };
  const amount = (
    value: string,
    path: string,
    rule: string,
    places?: number,
  ) => {
    if (!pattern.importe.test(value)) {
      add("VALUE_PATTERN_MISMATCH", path, rule);
      return false;
    }
    if (places !== undefined && decimalsOf(value) > places) {
      add("AMOUNT_DECIMALS_EXCEED_CURRENCY", path, rule);
      return false;
    }
    return true;
  };
  const personType = (rfc: string): PersonType =>
    rfc.length === 13 ? "INDIVIDUAL" : "COMPANY";

  // --- Comprobante -----------------------------------------------------------------------
  if (doc.version !== "4.0")
    add("VALUE_PATTERN_MISMATCH", root + "/@Version", "XSD:Version");
  text(doc.serie, 25, root + "/@Serie", "XSD:Serie");
  text(doc.folio, 40, root + "/@Folio", "XSD:Folio");
  if (!pattern.fechaH.test(doc.issuedAt))
    add("VALUE_PATTERN_MISMATCH", root + "/@Fecha", "CFDI40101");
  if (!pattern.postalCode.test(doc.placeOfIssue))
    add("VALUE_PATTERN_MISMATCH", root + "/@LugarExpedicion", "CFDI40126");
  else if (!catalogs.postalCode(doc.placeOfIssue))
    add("PLACE_OF_ISSUE_UNKNOWN", root + "/@LugarExpedicion", "CFDI40126");
  else
    catalog(
      catalogs.postalCode,
      doc.placeOfIssue,
      root + "/@LugarExpedicion",
      "CFDI40126",
    );
  const currency = catalog(
    catalogs.currency,
    doc.currency,
    root + "/@Moneda",
    "CFDI40113",
  );
  const places = currency?.decimals ?? 2;
  if (currency && (doc.currency === "XXX" || currency.decimals !== 2))
    add("CURRENCY_UNSUPPORTED", root + "/@Moneda", "ORBIT");
  if (doc.currency === "MXN") {
    if (doc.exchangeRate !== null && doc.exchangeRate !== "1")
      add("EXCHANGE_RATE_NOT_ALLOWED", root + "/@TipoCambio", "CFDI40114");
  } else if (doc.exchangeRate === null)
    add("EXCHANGE_RATE_MISSING", root + "/@TipoCambio", "CFDI40115");
  else if (
    !pattern.importe.test(doc.exchangeRate) ||
    dec(doc.exchangeRate).isZero()
  )
    add("VALUE_PATTERN_MISMATCH", root + "/@TipoCambio", "CFDI40117");
  catalog(
    catalogs.paymentForm,
    doc.paymentForm,
    root + "/@FormaPago",
    "CFDI40104",
  );
  catalog(
    catalogs.paymentMethod,
    doc.paymentMethod,
    root + "/@MetodoPago",
    "CFDI40124",
  );
  if (doc.paymentMethod === "PPD" && doc.paymentForm !== "99")
    add("PAYMENT_PPD_REQUIRES_99", root + "/@FormaPago", "CFDI40105");
  if (doc.paymentMethod === "PUE" && doc.paymentForm === "99")
    add("PAYMENT_PUE_FORM_UNDEFINED", root + "/@FormaPago", "ORBIT");
  catalog(
    catalogs.documentType,
    doc.documentType,
    root + "/@TipoDeComprobante",
    "CFDI40121",
  );
  if (
    catalog(
      catalogs.exportCode,
      doc.exportCode,
      root + "/@Exportacion",
      "CFDI40123",
    ) &&
    doc.exportCode !== "01"
  )
    add("EXPORT_UNSUPPORTED", root + "/@Exportacion", "ORBIT");

  // --- Emisor ----------------------------------------------------------------------------
  const issuerPath = root + "/Emisor";
  if (!pattern.rfc.test(doc.issuer.rfc))
    add("RFC_INVALID", issuerPath + "/@Rfc", "XSD:Rfc");
  text(doc.issuer.name, 300, issuerPath + "/@Nombre", "XSD:Nombre");
  const issuerRegime = catalog(
    catalogs.regime,
    doc.issuer.fiscalRegime,
    issuerPath + "/@RegimenFiscal",
    "CFDI40140",
  );
  if (
    issuerRegime &&
    !issuerRegime.personTypes.includes(personType(doc.issuer.rfc))
  )
    add(
      "REGIME_PERSON_TYPE_MISMATCH",
      issuerPath + "/@RegimenFiscal",
      "CFDI40141",
    );

  // --- Receptor --------------------------------------------------------------------------
  const receiverPath = root + "/Receptor";
  const receiver = doc.receiver;
  const generic = receiver.rfc === genericRfc.national;
  if (receiver.rfc === genericRfc.foreign)
    add("FOREIGN_RECEIVER_UNSUPPORTED", receiverPath + "/@Rfc", "ORBIT");
  if (!pattern.rfc.test(receiver.rfc))
    add("RFC_INVALID", receiverPath + "/@Rfc", "XSD:Rfc");
  text(receiver.name, 300, receiverPath + "/@Nombre", "XSD:Nombre");
  if (!pattern.postalCode.test(receiver.fiscalAddressPostalCode))
    add(
      "VALUE_PATTERN_MISMATCH",
      receiverPath + "/@DomicilioFiscalReceptor",
      "XSD:DomicilioFiscalReceptor",
    );
  else
    catalog(
      catalogs.postalCode,
      receiver.fiscalAddressPostalCode,
      receiverPath + "/@DomicilioFiscalReceptor",
      "ORBIT",
    );
  const receiverRegime = catalog(
    catalogs.regime,
    receiver.fiscalRegime,
    receiverPath + "/@RegimenFiscalReceptor",
    "CFDI40157",
  );
  if (
    receiverRegime &&
    !receiverRegime.personTypes.includes(personType(receiver.rfc))
  )
    add(
      "REGIME_PERSON_TYPE_MISMATCH",
      receiverPath + "/@RegimenFiscalReceptor",
      "CFDI40158",
    );
  if (generic) {
    if (receiver.fiscalRegime !== "616")
      add(
        "GENERIC_RECEIVER_REGIME",
        receiverPath + "/@RegimenFiscalReceptor",
        "CFDI40159",
      );
    if (receiver.fiscalAddressPostalCode !== doc.placeOfIssue)
      add(
        "GENERIC_RECEIVER_POSTAL_CODE",
        receiverPath + "/@DomicilioFiscalReceptor",
        "CFDI40149",
      );
  }
  const use = catalog(
    catalogs.cfdiUse,
    receiver.cfdiUse,
    receiverPath + "/@UsoCFDI",
    "CFDI40160",
  );
  if (
    use &&
    (!use.personTypes.includes(personType(receiver.rfc)) ||
      !use.receiverRegimes.includes(receiver.fiscalRegime))
  )
    add("CFDI_USE_INCOMPATIBLE", receiverPath + "/@UsoCFDI", "CFDI40161");

  // --- Conceptos -------------------------------------------------------------------------
  const conceptAmounts: CfdiDecimal[] = [];
  const conceptDiscounts: CfdiDecimal[] = [];
  const transferLines: {
    key: string;
    base: CfdiDecimal;
    amount: CfdiDecimal | null;
  }[] = [];
  const withholdingLines: { tax: string; amount: CfdiDecimal }[] = [];
  doc.concepts.forEach((c, i) => {
    const at = `${root}/Conceptos/Concepto[${i + 1}]`;
    // 01010101 is both the "no existe en el catálogo" key and the Fase 3 migration
    // default: it cannot be told apart from a choice, so it never reaches a real CFDI.
    if (c.productCode === genericProductCode)
      add("PRODUCT_CODE_GENERIC", at + "/@ClaveProdServ", "ORBIT");
    const product = xsdAware(
      catalogs.product,
      catalogs.productInXsdOnly,
      c.productCode,
      at + "/@ClaveProdServ",
      "CFDI40162",
    );
    if (
      productsRequiringComplement.has(c.productCode) ||
      (product && product.complement)
    )
      add(
        "PRODUCT_COMPLEMENT_UNSUPPORTED",
        at + "/@ClaveProdServ",
        productsRequiringComplement.has(c.productCode)
          ? "CFDI40228"
          : "CFDI40163",
      );
    if (product?.includeIeps === "S")
      add("PRODUCT_IEPS_UNSUPPORTED", at + "/@ClaveProdServ", "CFDI40164");
    if (
      product?.includeVat === "S" &&
      !c.taxes?.transfers.some((t) => t.tax === "002")
    )
      add("PRODUCT_REQUIRES_VAT", at + "/@ClaveProdServ", "CFDI40164");
    xsdAware(
      catalogs.unit,
      catalogs.unitInXsdOnly,
      c.unitCode,
      at + "/@ClaveUnidad",
      "CFDI40165",
    );
    text(c.description, 1000, at + "/@Descripcion", "XSD:Descripcion");
    if (!pattern.importe.test(c.quantity) || dec(c.quantity).isZero())
      add("VALUE_PATTERN_MISMATCH", at + "/@Cantidad", "XSD:Cantidad");
    if (
      amount(c.unitPrice, at + "/@ValorUnitario", "XSD:ValorUnitario") &&
      dec(c.unitPrice).isZero()
    )
      add("UNIT_PRICE_NOT_POSITIVE", at + "/@ValorUnitario", "CFDI40166");
    if (!amount(c.amount, at + "/@Importe", "XSD:Importe", places)) return;
    if (pattern.importe.test(c.quantity) && pattern.importe.test(c.unitPrice)) {
      if (!conceptAmountWithinLimits(c.quantity, c.unitPrice, c.amount))
        add("CONCEPT_AMOUNT_OUT_OF_LIMITS", at + "/@Importe", "CFDI40167");
      else if (
        !round(dec(c.quantity).mul(c.unitPrice), decimalsOf(c.amount)).equals(
          c.amount,
        )
      )
        add("CONCEPT_AMOUNT_NOT_EXACT", at + "/@Importe", "ORBIT");
    }
    conceptAmounts.push(dec(c.amount));
    let base = dec(c.amount);
    if (
      c.discount !== null &&
      amount(c.discount, at + "/@Descuento", "XSD:Descuento")
    ) {
      if (decimalsOf(c.discount) > decimalsOf(c.amount))
        add("DISCOUNT_DECIMALS_EXCEED_AMOUNT", at + "/@Descuento", "CFDI40168");
      if (dec(c.discount).greaterThan(c.amount))
        add("DISCOUNT_EXCEEDS_AMOUNT", at + "/@Descuento", "CFDI40169");
      conceptDiscounts.push(dec(c.discount));
      base = base.sub(c.discount);
    }
    if (
      catalog(
        catalogs.taxObject,
        c.taxObject,
        at + "/@ObjetoImp",
        "CFDI40170",
      ) &&
      !supportedTaxObjects.has(c.taxObject)
    )
      add("TAX_OBJECT_UNSUPPORTED", at + "/@ObjetoImp", "ORBIT");
    if (c.taxObject === "02" && !c.taxes)
      add("TAX_OBJECT_REQUIRES_TAXES", at + "/Impuestos", "CFDI40171");
    if (c.taxObject !== "02" && c.taxes)
      add("TAX_OBJECT_FORBIDS_TAXES", at + "/Impuestos", "CFDI40172");
    if (!c.taxes) return;
    if (!c.taxes.transfers.length && !c.taxes.withholdings.length)
      add("TAX_OBJECT_REQUIRES_TAXES", at + "/Impuestos", "CFDI40173");

    let transferredVatRate: CfdiDecimal | null = null;
    c.taxes.transfers.forEach((t, j) => {
      const tp = `${at}/Impuestos/Traslados/Traslado[${j + 1}]`;
      if (
        !amount(t.base, tp + "/@Base", "XSD:Base", places) ||
        !dec(t.base).greaterThan(0)
      ) {
        add("TAX_BASE_NOT_POSITIVE", tp + "/@Base", "CFDI40174");
        return;
      }
      if (!dec(t.base).equals(base))
        add("TAX_BASE_MISMATCH", tp + "/@Base", "ORBIT");
      const tax = catalog(catalogs.tax, t.tax, tp + "/@Impuesto", "CFDI40175");
      if (tax && !tax.transfer)
        add("CATALOG_CODE_UNKNOWN", tp + "/@Impuesto", "CFDI40175");
      catalog(catalogs.factor, t.factor, tp + "/@TipoFactor", "CFDI40176");
      if (t.factor === "Exento") {
        if (t.rate !== null || t.amount !== null)
          add("EXEMPT_WITH_RATE", tp, "CFDI40177");
        transferLines.push({
          key: `${t.tax}|Exento|`,
          base: dec(t.base),
          amount: null,
        });
        return;
      }
      if (t.rate === null || t.amount === null) {
        add("TAX_OBJECT_REQUIRES_TAXES", tp, "CFDI40178");
        return;
      }
      if (!pattern.rate.test(t.rate))
        add("VALUE_PATTERN_MISMATCH", tp + "/@TasaOCuota", "XSD:TasaOCuota");
      else if (t.rate === borderVatRate)
        add("VAT_BORDER_RATE_UNSUPPORTED", tp + "/@TasaOCuota", "ORBIT");
      else if (
        !rateInCatalog(catalogs, date, t.tax, t.factor, t.rate, "transfer")
      )
        add("RATE_NOT_IN_CATALOG", tp + "/@TasaOCuota", "CFDI40179");
      if (!amount(t.amount, tp + "/@Importe", "XSD:Importe", places)) return;
      if (!taxAmountWithinLimits(t.base, t.rate, t.amount))
        add("TAX_AMOUNT_OUT_OF_LIMITS", tp + "/@Importe", "CFDI40180");
      else if (
        !round(dec(t.base).mul(t.rate), decimalsOf(t.amount)).equals(t.amount)
      )
        add("TAX_AMOUNT_NOT_EXACT", tp + "/@Importe", "ORBIT");
      if (t.tax === "002") transferredVatRate = dec(t.rate);
      transferLines.push({
        key: `${t.tax}|${t.factor}|${t.rate}`,
        base: dec(t.base),
        amount: dec(t.amount),
      });
    });
    const seen = new Set<string>();
    c.taxes.withholdings.forEach((w, j) => {
      const wp = `${at}/Impuestos/Retenciones/Retencion[${j + 1}]`;
      if (seen.has(w.tax))
        add("DUPLICATE_TAX_GROUP", wp + "/@Impuesto", "ORBIT");
      seen.add(w.tax);
      if (
        !amount(w.base, wp + "/@Base", "XSD:Base", places) ||
        !dec(w.base).greaterThan(0)
      ) {
        add("TAX_BASE_NOT_POSITIVE", wp + "/@Base", "CFDI40181");
        return;
      }
      if (!dec(w.base).equals(base))
        add("TAX_BASE_MISMATCH", wp + "/@Base", "ORBIT");
      const tax = catalog(catalogs.tax, w.tax, wp + "/@Impuesto", "CFDI40182");
      if (tax && !tax.withholding)
        add("CATALOG_CODE_UNKNOWN", wp + "/@Impuesto", "CFDI40182");
      if (w.factor !== "Tasa")
        add("VALUE_PATTERN_MISMATCH", wp + "/@TipoFactor", "CFDI40184");
      catalog(catalogs.factor, w.factor, wp + "/@TipoFactor", "CFDI40183");
      if (!pattern.rate.test(w.rate))
        add("VALUE_PATTERN_MISMATCH", wp + "/@TasaOCuota", "XSD:TasaOCuota");
      else if (
        !rateInCatalog(catalogs, date, w.tax, w.factor, w.rate, "withholding")
      )
        add("RATE_NOT_IN_CATALOG", wp + "/@TasaOCuota", "CFDI40185");
      if (generic) add("GENERIC_RECEIVER_WITHHOLDING", wp, "ORBIT");
      if (w.tax === "002") {
        if (transferredVatRate === null)
          add("WITHHOLDING_VAT_WITHOUT_TRANSFER", wp, "ORBIT");
        else if (
          pattern.rate.test(w.rate) &&
          dec(w.rate).greaterThan(transferredVatRate)
        )
          add("WITHHOLDING_VAT_EXCEEDS_TRANSFER", wp + "/@TasaOCuota", "ORBIT");
      }
      if (!amount(w.amount, wp + "/@Importe", "XSD:Importe", places)) return;
      if (pattern.rate.test(w.rate)) {
        if (!taxAmountWithinLimits(w.base, w.rate, w.amount))
          add("TAX_AMOUNT_OUT_OF_LIMITS", wp + "/@Importe", "CFDI40186");
        else if (
          !round(dec(w.base).mul(w.rate), decimalsOf(w.amount)).equals(w.amount)
        )
          add("TAX_AMOUNT_NOT_EXACT", wp + "/@Importe", "ORBIT");
      }
      withholdingLines.push({ tax: w.tax, amount: dec(w.amount) });
    });
  });

  // --- Comprobante amounts -----------------------------------------------------------------
  if (
    amount(doc.subtotal, root + "/@SubTotal", "CFDI40107", places) &&
    !round(sum(conceptAmounts), places).equals(doc.subtotal)
  )
    add("SUBTOTAL_MISMATCH", root + "/@SubTotal", "CFDI40108");
  if (conceptDiscounts.length) {
    if (doc.discount === null)
      add("DISCOUNT_TOTAL_MISMATCH", root + "/@Descuento", "CFDI40111");
    else if (amount(doc.discount, root + "/@Descuento", "CFDI40112", places)) {
      if (!round(sum(conceptDiscounts), places).equals(doc.discount))
        add("DISCOUNT_TOTAL_MISMATCH", root + "/@Descuento", "CFDI40111");
      if (dec(doc.discount).greaterThan(doc.subtotal))
        add("DISCOUNT_EXCEEDS_AMOUNT", root + "/@Descuento", "CFDI40110");
    }
  } else if (doc.discount !== null)
    add("DISCOUNT_TOTAL_MISMATCH", root + "/@Descuento", "CFDI40111");

  // --- Impuestos (comprobante) -------------------------------------------------------------
  const taxesPath = root + "/Impuestos";
  const taxes = doc.taxes;
  if (!taxes) {
    if (transferLines.length || withholdingLines.length)
      add("TAX_SUMMARY_MISMATCH", taxesPath, "CFDI40205");
  } else {
    const groups = new Set<string>();
    let totalTransferred = new CfdiDecimal(0);
    taxes.transfers.forEach((t, j) => {
      const tp = `${taxesPath}/Traslados/Traslado[${j + 1}]`;
      const key = `${t.tax}|${t.factor}|${t.rate ?? ""}`;
      if (groups.has(key)) add("DUPLICATE_TAX_GROUP", tp, "CFDI40218");
      groups.add(key);
      const lines = transferLines.filter((l) => l.key === key);
      if (
        !amount(t.base, tp + "/@Base", "CFDI40214", places) ||
        !round(sum(lines.map((l) => l.base)), places).equals(t.base)
      )
        add(
          "TAX_SUMMARY_MISMATCH",
          tp + "/@Base",
          t.factor === "Exento" ? "CFDI40216" : "CFDI40215",
        );
      if (t.factor === "Exento") {
        if (t.rate !== null || t.amount !== null)
          add("EXEMPT_WITH_RATE", tp, "CFDI40213");
        return;
      }
      if (t.amount === null || t.rate === null) {
        add("TAX_SUMMARY_MISMATCH", tp, "CFDI40213");
        return;
      }
      if (!rateInCatalog(catalogs, date, t.tax, t.factor, t.rate, "transfer"))
        add("RATE_NOT_IN_CATALOG", tp + "/@TasaOCuota", "CFDI40219");
      if (
        !amount(t.amount, tp + "/@Importe", "CFDI40220", places) ||
        !round(
          sum(lines.map((l) => l.amount ?? new CfdiDecimal(0))),
          places,
        ).equals(t.amount)
      )
        add("TAX_SUMMARY_MISMATCH", tp + "/@Importe", "CFDI40221");
      else totalTransferred = totalTransferred.add(t.amount);
    });
    const lineKeys = new Set(transferLines.map((l) => l.key));
    if ([...lineKeys].some((k) => !groups.has(k)))
      add("TAX_SUMMARY_MISMATCH", taxesPath + "/Traslados", "CFDI40221");
    const taxed = taxes.transfers.some((t) => t.factor !== "Exento");
    if (taxed !== (taxes.totalTransferred !== null))
      add(
        "TAX_SUMMARY_MISMATCH",
        taxesPath + "/@TotalImpuestosTrasladados",
        "CFDI40212",
      );
    else if (
      taxes.totalTransferred !== null &&
      amount(
        taxes.totalTransferred,
        taxesPath + "/@TotalImpuestosTrasladados",
        "CFDI40204",
        places,
      ) &&
      !totalTransferred.equals(taxes.totalTransferred)
    )
      add(
        "TAX_SUMMARY_MISMATCH",
        taxesPath + "/@TotalImpuestosTrasladados",
        "CFDI40205",
      );

    const withheldTaxes = new Set<string>();
    let totalWithheld = new CfdiDecimal(0);
    taxes.withholdings.forEach((w, j) => {
      const wp = `${taxesPath}/Retenciones/Retencion[${j + 1}]`;
      if (withheldTaxes.has(w.tax)) add("DUPLICATE_TAX_GROUP", wp, "CFDI40208");
      withheldTaxes.add(w.tax);
      catalog(catalogs.tax, w.tax, wp + "/@Impuesto", "CFDI40207");
      if (
        !amount(w.amount, wp + "/@Importe", "CFDI40210", places) ||
        !round(
          sum(
            withholdingLines
              .filter((l) => l.tax === w.tax)
              .map((l) => l.amount),
          ),
          places,
        ).equals(w.amount)
      )
        add("TAX_SUMMARY_MISMATCH", wp + "/@Importe", "CFDI40211");
      else totalWithheld = totalWithheld.add(w.amount);
    });
    if (withholdingLines.some((l) => !withheldTaxes.has(l.tax)))
      add("TAX_SUMMARY_MISMATCH", taxesPath + "/Retenciones", "CFDI40211");
    if (taxes.withholdings.length > 0 !== (taxes.totalWithheld !== null))
      add(
        "TAX_SUMMARY_MISMATCH",
        taxesPath + "/@TotalImpuestosRetenidos",
        "CFDI40206",
      );
    else if (
      taxes.totalWithheld !== null &&
      amount(
        taxes.totalWithheld,
        taxesPath + "/@TotalImpuestosRetenidos",
        "CFDI40202",
        places,
      ) &&
      !totalWithheld.equals(taxes.totalWithheld)
    )
      add(
        "TAX_SUMMARY_MISMATCH",
        taxesPath + "/@TotalImpuestosRetenidos",
        "CFDI40203",
      );
  }

  // --- Total ---------------------------------------------------------------------------------
  if (amount(doc.total, root + "/@Total", "XSD:Total", places)) {
    const expected = dec(doc.subtotal)
      .sub(doc.discount ?? 0)
      .add(taxes?.totalTransferred ?? 0)
      .sub(taxes?.totalWithheld ?? 0);
    if (!expected.equals(doc.total))
      add("TOTAL_MISMATCH", root + "/@Total", "CFDI40119");
  }
  return issues;
}

/** c_TasaOCuota: fixed value or range for the tax, factor and direction, in force on `date`. */
function rateInCatalog(
  catalogs: Cfdi40Catalogs,
  date: string,
  tax: string,
  factor: string,
  rate: string,
  direction: "transfer" | "withholding",
) {
  const value = new CfdiDecimal(rate);
  return catalogs.rates.some(
    (r) =>
      r.tax === tax &&
      r.factor === factor &&
      r[direction] &&
      inForce(r, date) &&
      value.greaterThanOrEqualTo(r.min) &&
      value.lessThanOrEqualTo(r.max),
  );
}
