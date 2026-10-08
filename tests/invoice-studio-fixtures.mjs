// Browser-only synthetic responses for the missing Fase 5A endpoints.
// These are not imported by the application and do not emulate a PAC.
const option = (code, label, active = true) => ({ code, label, active });
export const contextFixture = {
  issuer: {
    organizationId: "local-fixture",
    legalName: "Empresa de prueba ORBIT",
    rfc: "AAA010101AAA",
    fiscalRegime: "601",
    postalCode: "06000",
    email: "issuer@example.test",
    profileComplete: true,
  },
  settings: {
    prefix: "ORB",
    currencyDefault: "MXN",
    paymentMethodDefault: "PUE",
    logoAvailable: false,
  },
  clients: [
    {
      id: "client-1",
      legalName: "Cliente de prueba",
      rfc: "BBB010101BBB",
      fiscalRegime: "601",
      postalCode: "06000",
      email: "client@example.test",
      cfdiUse: "G03",
      defaultPaymentForm: "03",
    },
    {
      id: "client-2",
      legalName: "Segundo cliente",
      rfc: "CCC010101CCC",
      fiscalRegime: "601",
      postalCode: "06100",
      cfdiUse: "G01",
      defaultPaymentForm: "01",
    },
  ],
  savedConcepts: [
    {
      id: "concept-1",
      name: "Servicio profesional",
      description: "Servicio del catálogo",
      productCode: "01010101",
      unitCode: "ACT",
      defaultQuantity: "1",
      unitPrice: "100",
      taxObject: "02",
      vatFactor: "TASA",
      vatRate: "0.16",
      active: true,
    },
  ],
  catalogs: {
    documentTypes: [
      option("I", "Ingreso"),
      option("E", "Egreso"),
      option("T", "Traslado"),
    ],
    paymentMethods: [
      option("PUE", "Pago en una sola exhibición"),
      option("PPD", "Pago en parcialidades o diferido"),
    ],
    paymentForms: [
      option("01", "Efectivo"),
      option("03", "Transferencia electrónica de fondos"),
      option("99", "Por definir"),
    ],
    cfdiUses: [
      option("G01", "Adquisición de mercancías"),
      option("G03", "Gastos en general"),
    ],
    fiscalRegimes: [option("601", "General de Ley Personas Morales")],
    currencies: [
      option("MXN", "Peso mexicano"),
      option("USD", "Dólar americano"),
    ],
    taxObjects: [
      option("01", "No objeto de impuesto"),
      option("02", "Sí objeto de impuesto"),
    ],
    exportCodes: [option("01", "No aplica")],
  },
};
export const evaluationFixture = {
  totals: {
    subtotal: "100.00",
    discount: "0.00",
    transferredTaxes: "16.00",
    withheldTaxes: "0.00",
    total: "116.00",
    lines: [
      {
        subtotal: "100.00",
        discount: "0.00",
        transferredTaxes: "16.00",
        withheldTaxes: "0.00",
        total: "116.00",
      },
    ],
  },
  validation: {
    valid: true,
    canMarkReady: true,
    sections: {
      issuer: "OK",
      receiver: "OK",
      document: "OK",
      payment: "OK",
      concepts: "OK",
      totals: "OK",
    },
    issues: [],
  },
};
export const conceptErrorFixture = {
  ...evaluationFixture,
  validation: {
    ...evaluationFixture.validation,
    valid: false,
    canMarkReady: false,
    sections: { ...evaluationFixture.validation.sections, concepts: "ERROR" },
    issues: [
      {
        code: "CONCEPT_DESCRIPTION_REQUIRED",
        severity: "ERROR",
        section: "concepts",
        field: "description",
        conceptIndex: 0,
        message: "Agrega una descripción para este concepto.",
      },
    ],
  },
};
