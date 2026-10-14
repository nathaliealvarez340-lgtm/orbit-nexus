// Fase 5C.4: stable fiscal error codes for building a CFDI 4.0. Messages are curated and
// never contain the values being validated (RFC, names, amounts, XML), so issues can be
// logged or audited without fiscal data. `rule` cites the source of each check:
// "CFDI40xxx" (official error matrix), "XSD:<attribute>" (cfdv40/tdCFDI facets),
// "ANEXO20" (technical standard) or "ORBIT" (product policy, stricter than the SAT).

export type Cfdi40IssueCategory =
  /** ORBIT is missing data the CFDI requires. */
  | "INCOMPLETE_DATA"
  /** Code absent from, or not in force in, the official catalog. */
  | "CATALOG"
  /** Values valid alone but not together. */
  | "COMBINATION"
  /** Amounts, sums or limits that do not reconcile. */
  | "CALCULATION"
  /** Outside the v1 scope: fails explicitly instead of producing approximate XML. */
  | "UNSUPPORTED"
  /** Text or value that cannot be expressed in the XML or violates an XSD facet. */
  | "SERIALIZATION"
  /** Official SAT resource or catalog missing or not matching its manifest hash. */
  | "RESOURCE"
  /** Schema validation result or gate. */
  | "XSD"
  /** An unsigned or unverified representation used where a sealed CFDI is required. */
  | "SEAL"
  /** Official XSLT, engine or cadena original that cannot be used (Fase 5C.5). */
  | "XSLT"
  /** Public CSD certificate data that cannot be used for the CFDI (Fase 5C.5). */
  | "CERTIFICATE"
  /** The CSD private key cannot be used to sign now: role, custody or key (Fase 5C.6). */
  | "SIGNING";

const issues = {
  // Incomplete ORBIT data.
  INVOICE_NOT_READY: [
    "INCOMPLETE_DATA",
    "La factura debe estar lista (READY) para construir el CFDI.",
  ],
  LEGACY_RECORD_REVIEW_REQUIRED: [
    "INCOMPLETE_DATA",
    "La factura se guardó con una versión anterior de ORBIT y sus datos fiscales pueden ser valores automáticos. Ábrela en Invoice Studio, revisa cada concepto y guárdala de nuevo.",
  ],
  TAX_OBJECT_MISSING: [
    "INCOMPLETE_DATA",
    "Selecciona el objeto de impuesto del concepto.",
  ],
  EXPORT_CODE_MISSING: [
    "INCOMPLETE_DATA",
    "Selecciona la clave de exportación de la factura.",
  ],
  ISSUER_DATA_MISSING: [
    "INCOMPLETE_DATA",
    "Faltan datos fiscales del emisor guardados en la factura.",
  ],
  RECEIVER_DATA_MISSING: [
    "INCOMPLETE_DATA",
    "Faltan datos fiscales del receptor guardados en la factura.",
  ],
  CFDI_USE_MISSING: ["INCOMPLETE_DATA", "Falta el Uso CFDI de la factura."],
  PAYMENT_METHOD_MISSING: ["INCOMPLETE_DATA", "Falta el método de pago."],
  PAYMENT_FORM_MISSING: ["INCOMPLETE_DATA", "Falta la forma de pago."],
  CONCEPTS_MISSING: ["INCOMPLETE_DATA", "La factura no tiene conceptos."],
  CONCEPT_VAT_MISSING: [
    "INCOMPLETE_DATA",
    "Un concepto objeto de impuesto no indica su IVA trasladado.",
  ],
  EXCHANGE_RATE_MISSING: [
    "INCOMPLETE_DATA",
    "Falta el tipo de cambio para una moneda distinta de MXN.",
  ],
  ISSUE_TIME_INVALID: [
    "INCOMPLETE_DATA",
    "La fecha de emisión generada por el servidor no es válida.",
  ],

  // Catalogs.
  CATALOG_CODE_UNKNOWN: [
    "CATALOG",
    "La clave no existe en el catálogo oficial del SAT.",
  ],
  PLACE_OF_ISSUE_UNKNOWN: [
    "CATALOG",
    "El código postal fiscal del emisor (lugar de expedición) no existe en el catálogo c_CodigoPostal. Corrígelo en el Perfil Fiscal; ORBIT no usa un código postal ni una zona horaria por defecto.",
  ],
  PRODUCT_CODE_GENERIC: [
    "COMBINATION",
    "La clave 01010101 (No existe en el catálogo) no se acepta para emitir: puede ser un valor automático de una versión anterior. Elige la clave específica de c_ClaveProdServ.",
  ],
  CATALOG_CODE_NOT_IN_FORCE: [
    "CATALOG",
    "La clave no está vigente en el catálogo oficial del SAT para la fecha de emisión.",
  ],
  CATALOG_CODE_UNVERIFIABLE: [
    "CATALOG",
    "La clave aparece en el XSD pero no en el catálogo oficial con vigencia; no puede verificarse.",
  ],
  RATE_NOT_IN_CATALOG: [
    "CATALOG",
    "La tasa no corresponde a c_TasaOCuota para ese impuesto y factor.",
  ],

  // Combinations.
  RFC_INVALID: ["COMBINATION", "El RFC no cumple el patrón oficial t_RFC."],
  PERSON_TYPE_MISMATCH: [
    "COMBINATION",
    "El tipo de persona guardado no corresponde con la longitud del RFC.",
  ],
  REGIME_PERSON_TYPE_MISMATCH: [
    "COMBINATION",
    "El régimen fiscal no aplica al tipo de persona del RFC.",
  ],
  CFDI_USE_INCOMPATIBLE: [
    "COMBINATION",
    "El Uso CFDI no aplica al tipo de persona o al régimen del receptor.",
  ],
  GENERIC_RECEIVER_REGIME: [
    "COMBINATION",
    "Con RFC genérico el régimen del receptor debe ser 616.",
  ],
  GENERIC_RECEIVER_POSTAL_CODE: [
    "COMBINATION",
    "Con RFC genérico el domicilio fiscal del receptor debe ser el lugar de expedición.",
  ],
  GENERIC_RECEIVER_WITHHOLDING: [
    "COMBINATION",
    "Un receptor con RFC genérico no puede efectuar retenciones.",
  ],
  PAYMENT_PPD_REQUIRES_99: [
    "COMBINATION",
    "Con método PPD la forma de pago debe ser 99.",
  ],
  PAYMENT_PUE_FORM_UNDEFINED: [
    "COMBINATION",
    "Con método PUE la forma de pago no puede ser 99.",
  ],
  EXCHANGE_RATE_NOT_ALLOWED: [
    "COMBINATION",
    "En MXN el tipo de cambio debe omitirse o ser 1.",
  ],
  TAX_OBJECT_FORBIDS_TAXES: [
    "COMBINATION",
    "Con ese objeto de impuesto el concepto no debe llevar impuestos.",
  ],
  TAX_OBJECT_REQUIRES_TAXES: [
    "COMBINATION",
    "Con objeto de impuesto 02 el concepto debe llevar impuestos.",
  ],
  EXEMPT_WITH_RATE: [
    "COMBINATION",
    "Un traslado exento no lleva TasaOCuota ni Importe.",
  ],
  WITHHOLDING_VAT_EXCEEDS_TRANSFER: [
    "COMBINATION",
    "La retención de IVA no puede ser mayor que el IVA trasladado del concepto.",
  ],
  WITHHOLDING_VAT_WITHOUT_TRANSFER: [
    "COMBINATION",
    "La retención de IVA requiere IVA trasladado a tasa en el concepto.",
  ],
  PRODUCT_REQUIRES_VAT: [
    "COMBINATION",
    "La clave de producto o servicio exige declarar el IVA trasladado.",
  ],
  ISSUE_DATE_DIFFERS_FROM_DRAFT: [
    "COMBINATION",
    "La fecha local de emisión no coincide con la fecha guardada en la factura.",
  ],
  ISSUE_TIME_ZONE_UNRESOLVED: [
    "COMBINATION",
    "El catálogo oficial c_CodigoPostal no permite determinar la hora local del código postal fiscal del emisor, y ORBIT no usa una zona horaria por defecto. Verifica el código postal del Perfil Fiscal; si es correcto, esa zona aún no está soportada para emitir.",
  ],
  DUPLICATE_TAX_GROUP: [
    "COMBINATION",
    "Hay más de un resumen para el mismo impuesto, factor y tasa.",
  ],

  // Calculations.
  AMOUNT_INVALID: [
    "CALCULATION",
    "Importe, cantidad o tasa con formato o decimales no válidos.",
  ],
  AMOUNT_DECIMALS_EXCEED_CURRENCY: [
    "CALCULATION",
    "El importe tiene más decimales de los que admite la moneda.",
  ],
  UNIT_PRICE_NOT_POSITIVE: [
    "CALCULATION",
    "El valor unitario debe ser mayor que cero.",
  ],
  QUANTITY_NOT_POSITIVE: [
    "CALCULATION",
    "La cantidad debe ser mayor que cero.",
  ],
  CONCEPT_AMOUNT_OUT_OF_LIMITS: [
    "CALCULATION",
    "El importe del concepto está fuera de los límites del Anexo 20.",
  ],
  CONCEPT_AMOUNT_NOT_EXACT: [
    "CALCULATION",
    "El importe del concepto no es el redondeo de cantidad por valor unitario.",
  ],
  DISCOUNT_DECIMALS_EXCEED_AMOUNT: [
    "CALCULATION",
    "El descuento tiene más decimales que el importe del concepto.",
  ],
  DISCOUNT_EXCEEDS_AMOUNT: [
    "CALCULATION",
    "El descuento es mayor que el importe.",
  ],
  TAX_BASE_NOT_POSITIVE: [
    "CALCULATION",
    "La base del impuesto debe ser mayor que cero.",
  ],
  TAX_BASE_MISMATCH: [
    "CALCULATION",
    "La base del impuesto no es el importe menos el descuento del concepto.",
  ],
  TAX_AMOUNT_OUT_OF_LIMITS: [
    "CALCULATION",
    "El importe del impuesto está fuera de los límites del Anexo 20.",
  ],
  TAX_AMOUNT_NOT_EXACT: [
    "CALCULATION",
    "El importe del impuesto no es el redondeo de base por tasa.",
  ],
  SUBTOTAL_MISMATCH: [
    "CALCULATION",
    "El SubTotal no es el redondeo de la suma de los importes de los conceptos.",
  ],
  DISCOUNT_TOTAL_MISMATCH: [
    "CALCULATION",
    "El Descuento no es el redondeo de la suma de los descuentos de los conceptos.",
  ],
  TAX_SUMMARY_MISMATCH: [
    "CALCULATION",
    "El resumen de impuestos no corresponde con los impuestos de los conceptos.",
  ],
  TOTAL_MISMATCH: [
    "CALCULATION",
    "El Total no es SubTotal menos Descuento más traslados menos retenciones.",
  ],
  TOTAL_NEGATIVE: [
    "CALCULATION",
    "Los descuentos y retenciones no pueden superar el importe del comprobante.",
  ],
  ORBIT_TOTALS_MISMATCH: [
    "CALCULATION",
    "Los importes calculados no coinciden con los guardados en la factura de ORBIT.",
  ],

  // Unsupported in v1 (fail explicitly).
  DOCUMENT_TYPE_UNSUPPORTED: [
    "UNSUPPORTED",
    "Solo se soporta el tipo de comprobante I (Ingreso).",
  ],
  CURRENCY_UNSUPPORTED: [
    "UNSUPPORTED",
    "Solo se soportan monedas con dos decimales en c_Moneda (no XXX).",
  ],
  EXPORT_UNSUPPORTED: [
    "UNSUPPORTED",
    "Solo se soporta Exportacion 01 (No aplica).",
  ],
  GLOBAL_INVOICE_UNSUPPORTED: [
    "UNSUPPORTED",
    "La factura global a público en general no está soportada.",
  ],
  FOREIGN_RECEIVER_UNSUPPORTED: [
    "UNSUPPORTED",
    "El receptor extranjero (RFC genérico XEXX010101000) no está soportado.",
  ],
  RELATED_CFDI_UNSUPPORTED: [
    "UNSUPPORTED",
    "Los CFDI relacionados no están soportados.",
  ],
  TAX_OBJECT_UNSUPPORTED: [
    "UNSUPPORTED",
    "Ese objeto de impuesto no está soportado.",
  ],
  VAT_BORDER_RATE_UNSUPPORTED: [
    "UNSUPPORTED",
    "El IVA de 8% (estímulo de región fronteriza) no está soportado.",
  ],
  PRODUCT_COMPLEMENT_UNSUPPORTED: [
    "UNSUPPORTED",
    "La clave de producto o servicio exige un complemento no soportado.",
  ],
  PRODUCT_IEPS_UNSUPPORTED: [
    "UNSUPPORTED",
    "La clave de producto o servicio exige IEPS, no soportado.",
  ],

  // Serialization.
  TEXT_REQUIRED: ["SERIALIZATION", "El texto es obligatorio."],
  TEXT_TOO_LONG: [
    "SERIALIZATION",
    "El texto excede la longitud que permite el esquema.",
  ],
  TEXT_PIPE_NOT_ALLOWED: [
    "SERIALIZATION",
    "El esquema no permite el carácter | en este texto.",
  ],
  TEXT_INVALID_CHARACTER: [
    "SERIALIZATION",
    "El texto contiene caracteres que XML no permite.",
  ],
  VALUE_PATTERN_MISMATCH: [
    "SERIALIZATION",
    "El valor no cumple el patrón del esquema.",
  ],
  XML_ROUND_TRIP_MISMATCH: [
    "SERIALIZATION",
    "El XML generado no reproduce exactamente los datos del comprobante.",
  ],

  // Resources.
  SAT_RESOURCE_MISSING: [
    "RESOURCE",
    "Falta un recurso oficial del SAT versionado.",
  ],
  SAT_RESOURCE_CORRUPT: [
    "RESOURCE",
    "Un recurso oficial del SAT no coincide con el hash de su manifiesto.",
  ],
  SAT_RESOURCE_PATH_INVALID: [
    "RESOURCE",
    "La ruta de un recurso oficial del SAT sale de resources/sat/cfdi40.",
  ],
  SEALED_CFDI_REQUIRED: [
    "SEAL",
    "Solo un CFDI sellado y verificado por ORBIT puede validarse contra el XSD o enviarse al PAC.",
  ],

  // Cadena original (Fase 5C.5).
  SAT_XSLT_RESOURCE_MISSING: [
    "XSLT",
    "Falta una plantilla XSLT oficial del SAT versionada; la cadena original no se genera.",
  ],
  SAT_XSLT_RESOURCE_INTEGRITY_FAILED: [
    "XSLT",
    "Una plantilla XSLT oficial no coincide con el hash de su manifiesto; la cadena original no se genera.",
  ],
  SAT_XSLT_RESOURCE_NOT_ALLOWED: [
    "XSLT",
    "La XSLT pidió un recurso que no es una plantilla oficial versionada; ORBIT no lo descarga ni lo lee.",
  ],
  XSLT_ENGINE_UNAVAILABLE: [
    "XSLT",
    "No hay un motor XSLT aprobado; la cadena original no se genera.",
  ],
  XSLT_TRANSFORM_FAILED: [
    "XSLT",
    "La XSLT oficial no pudo ejecutarse sobre el comprobante.",
  ],
  ORIGINAL_STRING_INVALID: [
    "XSLT",
    "El resultado de la XSLT oficial no tiene la forma de una cadena original (||…||).",
  ],
  PRE_SEAL_CFDI_REQUIRED: [
    "SEAL",
    "La cadena original solo se genera desde el XML pre-sello que ORBIT construyó con el certificado del CSD.",
  ],
  CERTIFICATE_BINDING_INVALID: [
    "CERTIFICATE",
    "El certificado no es un certificado de sello utilizable: debe ser X.509 vigente, no de autoridad, RSA, y su número debe corresponder a NoCertificado.",
  ],
  CSD_NOT_VALID: [
    "CERTIFICATE",
    "No hay un CSD activo y válido (vigente, del RFC del Perfil Fiscal y del entorno fiscal actual) para el comprobante.",
  ],
  CSD_CERTIFICATE_MISMATCH: [
    "CERTIFICATE",
    "El certificado guardado no corresponde con el registro del CSD (hash, número de serie o NoCertificado).",
  ],

  // Sello (Fase 5C.6). Before the private key is opened every condition is re-checked; any
  // failure stops there and the key is never decrypted.
  CSD_NOT_CONFIGURED: [
    "CERTIFICATE",
    "La organización no tiene un CSD activo para sellar el comprobante.",
  ],
  CSD_EXPIRED: [
    "CERTIFICATE",
    "El CSD activo no está vigente en el instante de sellado; no se abrió la llave privada.",
  ],
  CSD_ENVIRONMENT_MISMATCH: [
    "CERTIFICATE",
    "El CSD no corresponde al entorno fiscal actual (en SANDBOX solo se aceptan certificados de prueba demostrados); no se abrió la llave privada.",
  ],
  CSD_RFC_MISMATCH: [
    "CERTIFICATE",
    "El RFC del CSD no corresponde al emisor del comprobante; no se abrió la llave privada.",
  ],
  CSD_FORBIDDEN: [
    "SIGNING",
    "Solo un propietario o administrador puede sellar con el CSD de la organización.",
  ],
  CSD_SERVICE_UNAVAILABLE: [
    "SIGNING",
    "La custodia del CSD no está disponible para el entorno fiscal actual (PRODUCTION exige un proveedor KMS/HSM); no se selló.",
  ],
  CSD_KEY_UNAVAILABLE: [
    "SIGNING",
    "La llave privada del CSD no puede abrirse con la custodia configurada; no se selló.",
  ],
  CSD_KEY_INTEGRITY_FAILED: [
    "SIGNING",
    "La llave privada cifrada del CSD no superó su verificación de integridad; no se selló.",
  ],
  CSD_KEY_MISMATCH: [
    "SIGNING",
    "La llave privada custodiada no corresponde al certificado del CSD; no se selló.",
  ],
  CFDI_SEAL_FAILED: ["SIGNING", "No se pudo generar el sello del comprobante."],
  CFDI_SEAL_VERIFICATION_FAILED: [
    "SEAL",
    "El sello no se verificó con el certificado sobre la cadena original del XML; el comprobante no se considera sellado.",
  ],

  // XSD oficial (Fase 5C.7). Messages never carry the XML, values, paths of the server or
  // texts of the validator; the specific rule goes in `rule` ("XSD:<kind>").
  CFDI_XSD_INVALID: [
    "XSD",
    "El XML sellado no cumple el esquema oficial cfdv40.xsd del SAT (estructura, orden, tipos, atributos o facetas).",
  ],
  CFDI_XSD_UNSUPPORTED_NAMESPACE: [
    "XSD",
    "El XML contiene un espacio de nombres, complemento o addenda fuera del alcance soportado por ORBIT.",
  ],
  CFDI_XSD_MALFORMED_XML: ["XSD", "El XML no está bien formado."],
  CFDI_XSD_FORBIDDEN_MARKUP: [
    "XSD",
    "El XML contiene DOCTYPE, DTD, entidades, CDATA, comentarios o instrucciones de procesamiento; ORBIT no los acepta.",
  ],
  CFDI_XSD_SCHEMA_UNAVAILABLE: [
    "XSD",
    "El esquema oficial o el motor de validación XSD no están disponibles; el CFDI no se valida ni se envía al PAC.",
  ],
  CFDI_XSD_SCHEMA_INTEGRITY_FAILED: [
    "XSD",
    "El conjunto de esquemas oficiales no coincide con su manifiesto o pidió un recurso no permitido; el CFDI no se valida.",
  ],
  CFDI_XSD_VALIDATION_FAILED: [
    "XSD",
    "La validación XSD falló por un error interno; el CFDI no se considera validado.",
  ],
  XSD_VALIDATED_CFDI_REQUIRED: [
    "XSD",
    "Solo un CFDI sellado por ORBIT y validado contra el XSD oficial puede enviarse al PAC.",
  ],
} as const satisfies Record<string, readonly [Cfdi40IssueCategory, string]>;

export type Cfdi40IssueCode = keyof typeof issues;
export type Cfdi40Issue = {
  code: Cfdi40IssueCode;
  category: Cfdi40IssueCategory;
  /** XML path of the offending node or attribute, e.g. "Conceptos/Concepto[2]/@Importe". */
  path: string;
  /** CFDI40xxx, XSD:<attribute>, ANEXO20 or ORBIT. */
  rule: string;
  message: string;
  /** Position in the XML, when the issue comes from parsing or XSD validation (Fase 5C.7). */
  line?: number;
  column?: number;
};

export const cfdi40Issue = (
  code: Cfdi40IssueCode,
  path: string,
  rule: string,
  position?: { line: number; column: number },
): Cfdi40Issue => ({
  code,
  category: issues[code][0],
  path,
  rule,
  message: issues[code][1],
  ...(position ? { line: position.line, column: position.column } : {}),
});

export const cfdi40IssueCodes = Object.keys(issues) as Cfdi40IssueCode[];

/** Thrown when a CFDI cannot be built; carries only codes, paths and rules. */
export class Cfdi40Error extends Error {
  constructor(public readonly issues: readonly Cfdi40Issue[]) {
    super("CFDI40_BUILD_FAILED");
    this.name = "Cfdi40Error";
  }
}
