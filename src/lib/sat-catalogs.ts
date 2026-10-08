// CFDI 4.0 small catalogs (SAT, Anexo 20): the single source for backend validation and
// Invoice Studio (contract §12). Codes are persisted; labels are presentation only.
// `active: false` marks codes recognized by the catalog but not supported in Fase 5.
// Compatibility matrices follow catCFDI (c_UsoCFDI, c_RegimenFiscal); re-verify them
// against the official catalog version before real PAC stamping (Fase 5C).
import type {
  CatalogOption,
  InvoiceFiscalCatalogs,
} from "@/types/invoice-studio";

type PersonType = "INDIVIDUAL" | "COMPANY";
const F: PersonType = "INDIVIDUAL",
  M: PersonType = "COMPANY";
const on = (code: string, label: string): CatalogOption => ({
  code,
  label,
  active: true,
});
const off = (code: string, label: string): CatalogOption => ({
  code,
  label,
  active: false,
});

export const documentTypeCatalog = [
  on("I", "Ingreso"),
  off("E", "Egreso"),
  off("T", "Traslado"),
];

export const paymentMethodCatalog = [
  on("PUE", "Pago en una sola exhibición"),
  on("PPD", "Pago en parcialidades o diferido"),
];

export const paymentFormCatalog = [
  on("01", "Efectivo"),
  on("02", "Cheque nominativo"),
  on("03", "Transferencia electrónica de fondos"),
  on("04", "Tarjeta de crédito"),
  on("05", "Monedero electrónico"),
  on("06", "Dinero electrónico"),
  on("08", "Vales de despensa"),
  on("12", "Dación en pago"),
  on("13", "Pago por subrogación"),
  on("14", "Pago por consignación"),
  on("15", "Condonación"),
  on("17", "Compensación"),
  on("23", "Novación"),
  on("24", "Confusión"),
  on("25", "Remisión de deuda"),
  on("26", "Prescripción o caducidad"),
  on("27", "A satisfacción del acreedor"),
  on("28", "Tarjeta de débito"),
  on("29", "Tarjeta de servicios"),
  on("30", "Aplicación de anticipos"),
  on("31", "Intermediario pagos"),
  on("99", "Por definir"),
];

const regimes: [string, string, PersonType[]][] = [
  ["601", "General de Ley Personas Morales", [M]],
  ["603", "Personas Morales con Fines no Lucrativos", [M]],
  ["605", "Sueldos y Salarios e Ingresos Asimilados a Salarios", [F]],
  ["606", "Arrendamiento", [F]],
  ["607", "Régimen de Enajenación o Adquisición de Bienes", [F]],
  ["608", "Demás ingresos", [F]],
  [
    "610",
    "Residentes en el Extranjero sin Establecimiento Permanente en México",
    [F, M],
  ],
  ["611", "Ingresos por Dividendos (socios y accionistas)", [F]],
  [
    "612",
    "Personas Físicas con Actividades Empresariales y Profesionales",
    [F],
  ],
  ["614", "Ingresos por intereses", [F]],
  ["615", "Régimen de los ingresos por obtención de premios", [F]],
  ["616", "Sin obligaciones fiscales", [F]],
  [
    "620",
    "Sociedades Cooperativas de Producción que optan por diferir sus ingresos",
    [M],
  ],
  ["621", "Incorporación Fiscal", [F]],
  ["622", "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras", [M]],
  ["623", "Opcional para Grupos de Sociedades", [M]],
  ["624", "Coordinados", [M]],
  [
    "625",
    "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas",
    [F],
  ],
  ["626", "Régimen Simplificado de Confianza", [F, M]],
];
export const fiscalRegimeCatalog = regimes.map(([code, label]) =>
  on(code, label),
);
export const regimePersonTypes = new Map(
  regimes.map(([code, , types]) => [code, types]),
);

const businessRegimes = [
    "601",
    "603",
    "606",
    "612",
    "620",
    "621",
    "622",
    "623",
    "624",
    "625",
    "626",
  ],
  deductionRegimes = [
    "605",
    "606",
    "607",
    "608",
    "611",
    "612",
    "614",
    "615",
    "625",
  ],
  allRegimes = regimes.map(([code]) => code);
const uses: [string, string, PersonType[], string[]][] = [
  ["G01", "Adquisición de mercancías", [F, M], businessRegimes],
  ["G02", "Devoluciones, descuentos o bonificaciones", [F, M], businessRegimes],
  ["G03", "Gastos en general", [F, M], businessRegimes],
  ["I01", "Construcciones", [F, M], businessRegimes],
  [
    "I02",
    "Mobiliario y equipo de oficina por inversiones",
    [F, M],
    businessRegimes,
  ],
  ["I03", "Equipo de transporte", [F, M], businessRegimes],
  ["I04", "Equipo de cómputo y accesorios", [F, M], businessRegimes],
  [
    "I05",
    "Dados, troqueles, moldes, matrices y herramental",
    [F, M],
    businessRegimes,
  ],
  ["I06", "Comunicaciones telefónicas", [F, M], businessRegimes],
  ["I07", "Comunicaciones satelitales", [F, M], businessRegimes],
  ["I08", "Otra maquinaria y equipo", [F, M], businessRegimes],
  [
    "D01",
    "Honorarios médicos, dentales y gastos hospitalarios",
    [F],
    deductionRegimes,
  ],
  [
    "D02",
    "Gastos médicos por incapacidad o discapacidad",
    [F],
    deductionRegimes,
  ],
  ["D03", "Gastos funerales", [F], deductionRegimes],
  ["D04", "Donativos", [F], deductionRegimes],
  ["D05", "Intereses reales por créditos hipotecarios", [F], deductionRegimes],
  ["D06", "Aportaciones voluntarias al SAR", [F], deductionRegimes],
  ["D07", "Primas por seguros de gastos médicos", [F], deductionRegimes],
  [
    "D08",
    "Gastos de transportación escolar obligatoria",
    [F],
    deductionRegimes,
  ],
  [
    "D09",
    "Depósitos para el ahorro y primas de planes de pensiones",
    [F],
    deductionRegimes,
  ],
  ["D10", "Pagos por servicios educativos", [F], deductionRegimes],
  ["S01", "Sin efectos fiscales", [F, M], allRegimes],
  ["CP01", "Pagos", [F, M], allRegimes],
  ["CN01", "Nómina", [F], ["605"]],
];
// CP01 (Pagos) and CN01 (Nómina) belong to complements outside Fase 5.
export const cfdiUseCatalog = uses.map(([code, label]) =>
  code === "CP01" || code === "CN01" ? off(code, label) : on(code, label),
);
export const cfdiUseRules = new Map(
  uses.map(([code, , personTypes, receiverRegimes]) => [
    code,
    { personTypes, receiverRegimes },
  ]),
);

export const currencyCatalog = [
  on("MXN", "Peso Mexicano"),
  on("USD", "Dólar americano"),
  on("EUR", "Euro"),
];

export const taxObjectCatalog = [
  on("01", "No objeto de impuesto"),
  on("02", "Sí objeto de impuesto"),
  on("03", "Sí objeto del impuesto y no obligado al desglose"),
  on("04", "Sí objeto del impuesto y no causa impuesto"),
  off("05", "Sí objeto del impuesto, IVA crédito PODEBI"),
  off("06", "Sí objeto del IVA, No traslado IVA"),
  off("07", "No traslado del IVA, Sí desglose IEPS"),
  off("08", "No traslado del IVA, No desglose IEPS"),
];

export const exportCodeCatalog = [
  on("01", "No aplica"),
  off("02", "Definitiva con clave A1"),
  on("03", "Temporal"),
  on(
    "04",
    "Definitiva con clave distinta a A1 o cuando no existe enajenación en términos del CFF",
  ),
];

export const invoiceFiscalCatalogs: InvoiceFiscalCatalogs = {
  documentTypes: documentTypeCatalog,
  paymentMethods: paymentMethodCatalog,
  paymentForms: paymentFormCatalog,
  cfdiUses: cfdiUseCatalog,
  fiscalRegimes: fiscalRegimeCatalog,
  currencies: currencyCatalog,
  taxObjects: taxObjectCatalog,
  exportCodes: exportCodeCatalog,
};

// IVA traslado rates (c_TasaOCuota, TipoFactor Tasa) and withholding upper bounds.
export const vatRates = ["0.16", "0.08", "0"];
/** "0.160000" -> "0.16", "0.0" -> "0"; string-based so rates never pass through floats. */
export function canonicalRate(value: string) {
  return value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;
}
export const maxWithholdingVatRate = "0.16",
  maxWithholdingIsrRate = "0.35";
export const genericRfc = {
  publicGeneral: "XAXX010101000",
  foreign: "XEXX010101000",
} as const;
export const genericProductCode = "01010101";

const codes = (catalog: CatalogOption[]) => new Set(catalog.map((o) => o.code));
export const catalogCodes = {
  documentType: codes(documentTypeCatalog),
  paymentMethod: codes(paymentMethodCatalog),
  paymentForm: codes(paymentFormCatalog),
  fiscalRegime: codes(fiscalRegimeCatalog),
  cfdiUse: codes(cfdiUseCatalog),
  currency: codes(currencyCatalog),
  taxObject: codes(taxObjectCatalog),
  exportCode: codes(exportCodeCatalog),
};
export function catalogOption(catalog: CatalogOption[], code?: string | null) {
  return code ? catalog.find((o) => o.code === code) : undefined;
}
