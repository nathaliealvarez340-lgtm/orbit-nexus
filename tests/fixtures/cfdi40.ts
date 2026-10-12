// SYNTHETIC outgoing invoices for the CFDI 4.0 builder tests (Fase 5C.4). Fictitious RFCs,
// names and amounts; never data of real taxpayers or real CFDI.
//
// Status of every fixture: BUILDER_VALID means it passes ORBIT's normalizer, validator and
// round-trip check only. None is SAT-XSD-validated: there is no approved XSD engine, and
// the unsigned XML cannot be XSD-valid anyway (Sello, NoCertificado and Certificado are
// required by cfdv40.xsd).
import { Prisma } from "../../src/generated/prisma/browser";
import { calculateInvoiceTotals } from "../../src/lib/invoice-totals";
import type {
  OrbitConceptForCfdi,
  OrbitInvoiceForCfdi,
} from "../../src/lib/cfdi40/types";

export type FixtureStatus = "BUILDER_VALID" | "INVALID";

/** 2026-10-12 12:30:15 local time in 06600 (Tiempo del Centro, UTC-6). */
export const issuedAt = new Date("2026-10-12T18:30:15.700Z");

export const issuer = {
  rfc: "SCA010101AB1",
  legalName: "EMPRESA SINTETICA DE PRUEBAS",
  personType: "COMPANY",
  fiscalRegime: "601",
  postalCode: "06600",
  email: "fiscal@example.test",
  country: "MEX",
};
export const receivers = {
  company: {
    rfc: "SCB020202CD2",
    legalName: "CLIENTE SINTETICO DE PRUEBAS",
    personType: "COMPANY",
    fiscalRegime: "601",
    postalCode: "64000",
    email: "cliente@example.test",
    country: "MEX",
    cfdiUse: "G01",
  },
  individual: {
    rfc: "PEMA800101AB3",
    legalName: "PERSONA FISICA SINTETICA",
    personType: "INDIVIDUAL",
    fiscalRegime: "612",
    postalCode: "64000",
    email: "persona@example.test",
    country: "MEX",
  },
  generic: {
    rfc: "XAXX010101000",
    legalName: "CLIENTE SIN RFC",
    personType: "INDIVIDUAL",
    fiscalRegime: "616",
    postalCode: "06600",
    email: "sinrfc@example.test",
    country: "MEX",
  },
};

export type ConceptSpec = {
  description?: string;
  productCode?: string;
  unitCode?: string;
  quantity: string;
  unitPrice: string;
  discount?: string;
  taxObject?: string;
  vatFactor?: "TASA" | "EXENTO";
  /** Defaults to 0.16 for ObjetoImp 02 at TASA; null means no rate. */
  vatRate?: string | null;
  withholdingVatRate?: string;
  withholdingIsrRate?: string;
};

// Values as Prisma returns them after storing in the Decimal columns (toFixed()).
const stored = (value: InstanceType<typeof Prisma.Decimal> | string) =>
  new Prisma.Decimal(value).toFixed();

/**
 * ORBIT invoice snapshot with totals computed by ORBIT's own calculateInvoiceTotals, the
 * same function that persists a draft, so the builder's reconciliation is exercised.
 */
export function orbitInvoice(
  concepts: ConceptSpec[],
  overrides: Partial<OrbitInvoiceForCfdi> = {},
): OrbitInvoiceForCfdi {
  const lines = concepts.map((c) => {
    const taxObject = c.taxObject ?? "02";
    const vatFactor = c.vatFactor ?? "TASA";
    const vatRate =
      c.vatRate !== undefined
        ? c.vatRate
        : taxObject === "02" && vatFactor === "TASA"
          ? "0.16"
          : null;
    return {
      ...c,
      taxObject,
      vatFactor,
      vatRate,
      discount: c.discount ?? "0",
    };
  });
  const totals = calculateInvoiceTotals(
    lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
      taxObject: l.taxObject,
      vatFactor: l.vatFactor,
      vatRate: l.vatRate ?? undefined,
      withholdingVatRate: l.withholdingVatRate,
      withholdingIsrRate: l.withholdingIsrRate,
    })),
  );
  const conceptRows: OrbitConceptForCfdi[] = lines.map((l, i) => ({
    position: i,
    description: l.description ?? "Servicio de facturación sintético",
    productCode: l.productCode ?? "84111506",
    unitCode: l.unitCode ?? "E48",
    quantity: stored(l.quantity),
    unitPrice: stored(l.unitPrice),
    discount: stored(l.discount),
    taxObject: l.taxObject,
    vatFactor: l.vatFactor,
    vatRate: l.vatRate === null ? null : stored(l.vatRate),
    appliedVatRate:
      l.taxObject === "02" && l.vatFactor === "TASA" && l.vatRate
        ? stored(l.vatRate)
        : "0",
    withholdingVatRate: l.withholdingVatRate
      ? stored(l.withholdingVatRate)
      : null,
    withholdingIsrRate: l.withholdingIsrRate
      ? stored(l.withholdingIsrRate)
      : null,
    totals: {
      amount: stored(totals.lines[i].subtotal),
      discount: stored(totals.lines[i].discount),
      transferred: stored(totals.lines[i].transferredTaxes),
      withheldVat: stored(totals.lines[i].withheldVat),
      withheldIsr: stored(totals.lines[i].withheldIsr),
    },
  }));
  return {
    id: "synthetic-invoice",
    organizationId: "synthetic-org",
    status: "READY",
    version: 3,
    folio: "ORB-000123",
    invoiceDate: "2026-10-12",
    documentType: "I",
    currency: "MXN",
    exchangeRate: null,
    cfdiUse: "G03",
    paymentMethod: "PUE",
    paymentForm: "03",
    exportCode: "01",
    issuerSnapshot: issuer,
    receiverSnapshot: receivers.company,
    totals: {
      subtotal: stored(totals.subtotal),
      discount: stored(totals.discount),
      transferred: stored(totals.transferredTaxes),
      withheldVat: stored(totals.withheldVat),
      withheldIsr: stored(totals.withheldIsr),
      total: stored(totals.total),
    },
    concepts: conceptRows,
    legacyRecord: false,
    ...overrides,
  };
}

/** Builder-valid fixtures (none SAT-XSD-validated). */
export const validFixtures: Record<
  string,
  { status: FixtureStatus; invoice: () => OrbitInvoiceForCfdi }
> = {
  "ingreso-pue-iva16": {
    status: "BUILDER_VALID",
    invoice: () => orbitInvoice([{ quantity: "1", unitPrice: "1000" }]),
  },
  "ingreso-ppd": {
    status: "BUILDER_VALID",
    invoice: () =>
      orbitInvoice([{ quantity: "3", unitPrice: "450.5" }], {
        paymentMethod: "PPD",
        paymentForm: "99",
      }),
  },
  "ingreso-exento": {
    status: "BUILDER_VALID",
    invoice: () =>
      orbitInvoice([
        { quantity: "1", unitPrice: "800", vatFactor: "EXENTO", vatRate: null },
      ]),
  },
  "ingreso-descuento": {
    status: "BUILDER_VALID",
    invoice: () =>
      orbitInvoice([{ quantity: "2", unitPrice: "1250", discount: "250" }]),
  },
  "ingreso-multiples-conceptos": {
    status: "BUILDER_VALID",
    invoice: () =>
      orbitInvoice([
        {
          quantity: "2",
          unitPrice: "1500",
          discount: "100",
          withholdingVatRate: "0.106667",
          withholdingIsrRate: "0.1",
        },
        {
          quantity: "1",
          unitPrice: "250.5",
          vatFactor: "EXENTO",
          vatRate: null,
        },
        { quantity: "1.5", unitPrice: "99.99", vatRate: "0" },
        {
          quantity: "0.3333",
          unitPrice: "10",
          productCode: "80101500",
          unitCode: "H87",
        },
        { quantity: "1", unitPrice: "120", taxObject: "01", vatRate: null },
      ]),
  },
  "ingreso-retenciones-persona-moral": {
    status: "BUILDER_VALID",
    invoice: () =>
      orbitInvoice(
        [
          {
            quantity: "1",
            unitPrice: "10000",
            withholdingVatRate: "0.106667",
            withholdingIsrRate: "0.1",
          },
        ],
        {
          issuerSnapshot: { ...receivers.individual, postalCode: "06600" },
          receiverSnapshot: receivers.company,
        },
      ),
  },
  "ingreso-unicode-escape": {
    status: "BUILDER_VALID",
    invoice: () =>
      orbitInvoice(
        [
          {
            quantity: "1",
            unitPrice: "100",
            description: "Diseño & \"montaje\" <ÑANDÚ> 'año'  2026 \u{1F680}",
          },
        ],
        {
          issuerSnapshot: { ...issuer, legalName: "PEÑA & ASOCIADOS" },
          receiverSnapshot: {
            ...receivers.company,
            legalName: "CAFÉ  <EL\tSOL>",
          },
        },
      ),
  },
  "ingreso-usd-tipo-cambio": {
    status: "BUILDER_VALID",
    invoice: () =>
      orbitInvoice([{ quantity: "10", unitPrice: "25.5" }], {
        currency: "USD",
        exchangeRate: "17.254300",
      }),
  },
  "ingreso-rfc-generico-nacional": {
    status: "BUILDER_VALID",
    invoice: () =>
      orbitInvoice([{ quantity: "1", unitPrice: "500" }], {
        receiverSnapshot: receivers.generic,
        cfdiUse: "S01",
      }),
  },
  "ingreso-persona-fisica": {
    status: "BUILDER_VALID",
    invoice: () =>
      orbitInvoice([{ quantity: "4", unitPrice: "312.75" }], {
        receiverSnapshot: receivers.individual,
      }),
  },
};
