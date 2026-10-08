import "server-only";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/tenant";
import { ApiError, enforceRateLimit } from "@/lib/http";
import { InvoiceApiError } from "@/lib/invoice-api";
import {
  draftSchema,
  readyRequestSchema,
  settingsSchema,
  updateDraftSchema,
  type InvoiceDraftInput,
} from "@/lib/phase3-validation";
import { fiscalProfileComplete } from "@/lib/fiscal-catalogs";
import {
  calculateInvoiceTotals,
  serializeInvoiceTotals,
  type CalculatedInvoiceTotals,
} from "@/lib/invoice-totals";
import {
  buildValidationResult,
  issuesFromStructure,
  validateInvoiceRules,
  type RuleParty,
} from "@/lib/invoice-rules";
import {
  canonicalRate,
  invoiceFiscalCatalogs,
  vatRates,
} from "@/lib/sat-catalogs";
import { largeCatalogSources } from "@/lib/sat-catalogs-large";
import type {
  Client,
  FiscalProfile,
  InvoiceSettings,
  Prisma,
  StampedInvoice,
  StampedInvoiceConcept,
} from "@/generated/prisma/client";
import type {
  CreateInvoiceDraftResponse,
  InvoiceDraftConcept,
  InvoiceDraftDetail,
  InvoicePartySnapshot,
  InvoiceStudioClient,
  InvoiceStudioContext,
  InvoiceTotals,
  InvoiceValidationIssue,
  InvoiceValidationResult,
  ValidateInvoiceDraftResponse,
} from "@/types/invoice-studio";
import { requireInvoicePlan } from "./plans";
import { savedConceptDto } from "./invoice-concepts";

type Db = Prisma.TransactionClient;
type StoredInvoice = StampedInvoice & { concepts: StampedInvoiceConcept[] };
const orderedConcepts = {
  concepts: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
};

export async function outgoingContext() {
  const tenant = await requireInvoicePlan();
  const db = getDb(),
    organizationId = tenant.organizationId;
  const [profile, settings, clients, drafts] = await Promise.all([
    db.fiscalProfile.findUnique({ where: { organizationId } }),
    db.invoiceSettings.findUnique({ where: { organizationId } }),
    db.client.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { legalName: "asc" },
      take: 500,
    }),
    db.stampedInvoice.findMany({
      where: { organizationId, status: { in: ["DRAFT", "READY"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return { tenant, profile, settings, clients, drafts };
}

export async function saveInvoiceSettings(input: unknown) {
  const { organizationId, userId, role } = await requireInvoicePlan();
  requireAdmin(role);
  const data = settingsSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    if (
      !(await tx.document.findFirst({
        where: {
          id: data.logoDocumentId,
          organizationId,
          kind: "INVOICE_LOGO",
        },
      }))
    )
      throw new ApiError(400, "Carga un logo válido de esta empresa.");
    // Contract §10: new configurations default to PUE; the payment form is never invented.
    const settings = await tx.invoiceSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        ...data,
        paymentMethodDefault:
          data.paymentMethodDefault === undefined
            ? "PUE"
            : data.paymentMethodDefault,
      },
      update: data,
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_SETTINGS_UPDATED",
        entityType: "InvoiceSettings",
      },
    });
    return settings;
  });
}

// ---------------------------------------------------------------------------
// Snapshots: only the CFDI-relevant issuer/receiver fields are copied into drafts.

const snapshotKeys = [
  "rfc",
  "legalName",
  "personType",
  "fiscalRegime",
  "postalCode",
  "email",
  "country",
  "cfdiUse",
  "foreignTaxId",
  "street",
  "exteriorNumber",
  "interiorNumber",
  "colony",
  "locality",
  "municipality",
  "state",
] as const;
const issuerFactKeys = [
  "rfc",
  "legalName",
  "personType",
  "fiscalRegime",
  "postalCode",
] as const;
const receiverFactKeys = [
  ...issuerFactKeys,
  "foreignTaxId",
  "country",
] as const;

function pickSnapshot(source: Record<string, unknown>): InvoicePartySnapshot {
  const picked = Object.fromEntries(
    snapshotKeys.flatMap((key) =>
      typeof source[key] === "string" && source[key] !== ""
        ? [[key, source[key]]]
        : [],
    ),
  );
  return {
    rfc: "",
    legalName: "",
    personType: "",
    fiscalRegime: "",
    postalCode: "",
    email: "",
    country: "",
    ...picked,
  };
}
const issuerSnapshot = (profile: FiscalProfile) =>
  pickSnapshot({ ...profile, cfdiUse: undefined });
const receiverSnapshot = (client: Client) => pickSnapshot({ ...client });
function readSnapshot(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? pickSnapshot(value as Record<string, unknown>)
    : null;
}
function partyFacts(s: InvoicePartySnapshot): RuleParty {
  return {
    rfc: s.rfc,
    legalName: s.legalName,
    personType: s.personType,
    fiscalRegime: s.fiscalRegime,
    postalCode: s.postalCode,
    country: s.country,
    ...(s.foreignTaxId ? { foreignTaxId: s.foreignTaxId } : {}),
  };
}
function snapshotChanged(
  current: InvoicePartySnapshot,
  stored: InvoicePartySnapshot,
  keys: readonly (keyof InvoicePartySnapshot)[],
) {
  return keys.some((key) => (current[key] ?? "") !== (stored[key] ?? ""));
}

// ---------------------------------------------------------------------------
// Totals, validation and persistence mapping.

const amountLimit = "10000000000";
function amountsInRange(t: CalculatedInvoiceTotals) {
  return [
    t.subtotal,
    t.discount,
    t.transferredTaxes,
    t.withheldVat,
    t.withheldIsr,
    t.total,
    ...t.lines.flatMap((l) => [
      l.subtotal,
      l.transferredTaxes,
      l.withheldTaxes,
      l.total,
    ]),
  ].every((v) => v.abs().lessThan(amountLimit));
}
const outOfRangeIssue: InvoiceValidationIssue = {
  code: "AMOUNT_OUT_OF_RANGE",
  severity: "ERROR",
  section: "totals",
  message: "Los importes exceden el máximo permitido.",
};
function totalsWithinLimits(data: InvoiceDraftInput) {
  const totals = calculateInvoiceTotals(data.concepts);
  if (!amountsInRange(totals))
    throw new InvoiceApiError(
      400,
      "Importe fuera de rango.",
      "AMOUNT_OUT_OF_RANGE",
    );
  return totals;
}
const mexicoToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

type DraftRefs = {
  profile: FiscalProfile | null;
  client: Client | null;
  inactiveSaved: Set<string>;
  missingSaved: Set<string>;
};
async function loadDraftRefs(
  db: Db,
  organizationId: string,
  data: InvoiceDraftInput,
): Promise<DraftRefs> {
  const savedIds = [
    ...new Set(
      data.concepts.flatMap((c) =>
        c.savedConceptId ? [c.savedConceptId] : [],
      ),
    ),
  ];
  const profile = await db.fiscalProfile.findUnique({
    where: { organizationId },
  });
  const client = await db.client.findFirst({
    where: { id: data.clientId, organizationId, archivedAt: null },
  });
  // Saved concepts resolve only inside the authorized Organization.
  const saved = savedIds.length
    ? await db.savedInvoiceConcept.findMany({
        where: { organizationId, id: { in: savedIds } },
        select: { id: true, active: true },
      })
    : [];
  const found = new Set(saved.map((s) => s.id));
  return {
    profile,
    client,
    inactiveSaved: new Set(saved.filter((s) => !s.active).map((s) => s.id)),
    missingSaved: new Set(savedIds.filter((id) => !found.has(id))),
  };
}

function evaluate(
  data: InvoiceDraftInput,
  issuer: (RuleParty & { profileComplete: boolean }) | null,
  receiver: (RuleParty & { available?: boolean }) | null,
  totals: CalculatedInvoiceTotals,
  inactiveSaved: ReadonlySet<string>,
  extra: InvoiceValidationIssue[] = [],
): InvoiceValidationResult {
  return buildValidationResult(
    [
      ...validateInvoiceRules({
        issuer,
        receiver,
        draft: data,
        totals,
        today: mexicoToday(),
        isKnownProductCode: largeCatalogSources["product-services"].has,
        isKnownUnitCode: largeCatalogSources.units.has,
        inactiveSavedConceptIds: inactiveSaved,
      }),
      ...extra,
    ],
    data.documentType,
  );
}
function evaluateDraft(
  data: InvoiceDraftInput,
  refs: DraftRefs,
  totals: CalculatedInvoiceTotals,
  extra: InvoiceValidationIssue[] = [],
) {
  return evaluate(
    data,
    refs.profile
      ? {
          ...partyFacts(issuerSnapshot(refs.profile)),
          profileComplete: fiscalProfileComplete(refs.profile),
        }
      : null,
    refs.client ? partyFacts(receiverSnapshot(refs.client)) : null,
    totals,
    refs.inactiveSaved,
    extra,
  );
}

const json = (value: unknown) => value as Prisma.InputJsonValue;
function draftFields(
  data: InvoiceDraftInput,
  profile: FiscalProfile,
  client: Client,
  totals: CalculatedInvoiceTotals,
  validation: InvoiceValidationResult,
) {
  return {
    clientId: client.id,
    issuerRfc: profile.rfc,
    receiverRfc: client.rfc,
    invoiceDate: new Date(data.invoiceDate + "T00:00:00Z"),
    documentType: data.documentType,
    currency: data.currency,
    exchangeRate: data.exchangeRate ?? null,
    cfdiUse: data.cfdiUse,
    paymentMethod: data.paymentMethod ?? null,
    paymentForm: data.paymentForm ?? null,
    exportCode: data.exportCode,
    issuerSnapshot: json(issuerSnapshot(profile)),
    receiverSnapshot: json(receiverSnapshot(client)),
    subtotal: totals.subtotal.toFixed(2),
    discount: totals.discount.toFixed(2),
    tax: totals.transferredTaxes.toFixed(2),
    withheldVat: totals.withheldVat.toFixed(2),
    withheldIsr: totals.withheldIsr.toFixed(2),
    total: totals.total.toFixed(2),
    validation: json(validation),
  };
}
function templateSnapshot(settings: InvoiceSettings) {
  return json({
    color: settings.color,
    template: settings.template,
    logoDocumentId: settings.logoDocumentId,
  });
}
// Lines are snapshots of the request; saved concepts are only referenced for traceability.
function conceptRows(data: InvoiceDraftInput, totals: CalculatedInvoiceTotals) {
  return data.concepts.map((c, position) => {
    const line = totals.lines[position];
    const applied =
      c.taxObject === "02" && c.vatFactor === "TASA" && c.vatRate
        ? c.vatRate
        : "0";
    return {
      position,
      savedConceptId: c.savedConceptId ?? null,
      description: c.description,
      productCode: c.productCode,
      unitCode: c.unitCode,
      quantity: c.quantity,
      unitPrice: c.unitPrice,
      discount: c.discount ?? "0",
      taxObject: c.taxObject,
      vatFactor: c.vatFactor,
      vatRate: c.vatRate ?? null,
      taxRate: vatRates.includes(canonicalRate(applied)) ? applied : "0",
      withholdingVatRate: c.withholdingVatRate ?? null,
      withholdingIsrRate: c.withholdingIsrRate ?? null,
      subtotal: line.subtotal.toFixed(2),
      transferredTaxes: line.transferredTaxes.toFixed(2),
      withheldVat: line.withheldVat.toFixed(2),
      withheldIsr: line.withheldIsr.toFixed(2),
      total: line.total.toFixed(2),
    };
  });
}

function storedConcept(c: StampedInvoiceConcept): InvoiceDraftConcept {
  return {
    ...(c.savedConceptId ? { savedConceptId: c.savedConceptId } : {}),
    description: c.description,
    productCode: c.productCode,
    unitCode: c.unitCode,
    quantity: c.quantity.toString(),
    unitPrice: c.unitPrice.toFixed(2),
    discount: c.discount.toFixed(2),
    taxObject: c.taxObject,
    vatFactor: c.vatFactor === "EXENTO" ? "EXENTO" : "TASA",
    ...(c.vatRate ? { vatRate: c.vatRate.toString() } : {}),
    ...(c.withholdingVatRate
      ? { withholdingVatRate: c.withholdingVatRate.toString() }
      : {}),
    ...(c.withholdingIsrRate
      ? { withholdingIsrRate: c.withholdingIsrRate.toString() }
      : {}),
  };
}
function storedTotals(invoice: StoredInvoice): InvoiceTotals {
  return {
    subtotal: invoice.subtotal.toFixed(2),
    discount: invoice.discount.toFixed(2),
    transferredTaxes: invoice.tax.toFixed(2),
    withheldTaxes: invoice.withheldVat.add(invoice.withheldIsr).toFixed(2),
    total: invoice.total.toFixed(2),
    lines: invoice.concepts.map((c) => ({
      subtotal: c.subtotal.toFixed(2),
      discount: c.discount.toFixed(2),
      transferredTaxes: c.transferredTaxes.toFixed(2),
      withheldTaxes: c.withheldVat.add(c.withheldIsr).toFixed(2),
      total: c.total.toFixed(2),
    })),
  };
}
const draftStatus = (status: string) =>
  status === "READY" ? "READY" : "DRAFT";
function saveResponse(
  invoice: StampedInvoice,
  totals: InvoiceTotals,
  validation: InvoiceValidationResult,
): CreateInvoiceDraftResponse {
  return {
    id: invoice.id,
    folio: invoice.folio,
    status: draftStatus(invoice.status),
    totals,
    validation,
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

// Revalidates the document exactly as stored, against the current tenant data.
async function validateStoredInvoice(
  db: Db,
  organizationId: string,
  invoice: StoredInvoice,
): Promise<InvoiceValidationResult> {
  const parsed = draftSchema.safeParse({
    clientId: invoice.clientId ?? "",
    invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? "",
    documentType: invoice.documentType,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate?.toString(),
    cfdiUse: invoice.cfdiUse ?? "",
    paymentMethod: invoice.paymentMethod ?? undefined,
    paymentForm: invoice.paymentForm ?? undefined,
    exportCode: invoice.exportCode,
    concepts: invoice.concepts.map(storedConcept),
  });
  if (!parsed.success)
    return buildValidationResult(issuesFromStructure(parsed.error.issues));
  const profile = await db.fiscalProfile.findUnique({
    where: { organizationId },
  });
  const client = invoice.clientId
    ? await db.client.findFirst({
        where: { id: invoice.clientId, organizationId },
      })
    : null;
  const savedIds = invoice.concepts.flatMap((c) =>
    c.savedConceptId ? [c.savedConceptId] : [],
  );
  const inactive = savedIds.length
    ? await db.savedInvoiceConcept.findMany({
        where: { organizationId, id: { in: savedIds }, active: false },
        select: { id: true },
      })
    : [];
  const issuerSnap = readSnapshot(invoice.issuerSnapshot),
    receiverSnap = readSnapshot(invoice.receiverSnapshot);
  const extra: InvoiceValidationIssue[] = [];
  if (
    profile &&
    issuerSnap &&
    snapshotChanged(issuerSnapshot(profile), issuerSnap, issuerFactKeys)
  )
    extra.push({
      code: "ISSUER_SNAPSHOT_OUTDATED",
      severity: "ERROR",
      section: "issuer",
      message:
        "El perfil fiscal cambió después de guardar el borrador; guárdalo de nuevo para actualizar los datos del emisor.",
    });
  if (
    client &&
    receiverSnap &&
    snapshotChanged(receiverSnapshot(client), receiverSnap, receiverFactKeys)
  )
    extra.push({
      code: "RECEIVER_SNAPSHOT_OUTDATED",
      severity: "ERROR",
      section: "receiver",
      field: "clientId",
      message:
        "Los datos del cliente cambiaron después de guardar el borrador; guárdalo de nuevo para actualizarlos.",
    });
  return evaluate(
    parsed.data,
    profile && issuerSnap
      ? {
          ...partyFacts(issuerSnap),
          profileComplete: fiscalProfileComplete(profile),
        }
      : null,
    client && receiverSnap
      ? { ...partyFacts(receiverSnap), available: !client.archivedAt }
      : null,
    calculateInvoiceTotals(parsed.data.concepts),
    new Set(inactive.map((s) => s.id)),
    extra,
  );
}

function missingSavedIssues(
  data: InvoiceDraftInput,
  missing: ReadonlySet<string>,
) {
  return data.concepts.flatMap((c, conceptIndex): InvoiceValidationIssue[] =>
    c.savedConceptId && missing.has(c.savedConceptId)
      ? [
          {
            code: "SAVED_CONCEPT_NOT_AVAILABLE",
            severity: "ERROR",
            section: "concepts",
            field: "savedConceptId",
            conceptIndex,
            message: "El concepto guardado no está disponible en esta empresa.",
          },
        ]
      : [],
  );
}

// ---------------------------------------------------------------------------
// Invoice Studio APIs (contract §20-28).

function clientDto(c: Client): InvoiceStudioClient {
  return {
    id: c.id,
    legalName: c.legalName,
    rfc: c.rfc,
    fiscalRegime: c.fiscalRegime,
    postalCode: c.postalCode,
    cfdiUse: c.cfdiUse,
    defaultPaymentForm: c.defaultPaymentForm,
    email: c.email,
    personType: c.personType,
    ...(c.foreignTaxId ? { foreignTaxId: c.foreignTaxId } : {}),
    country: c.country,
  };
}
const paymentMethod = (value: string | null | undefined) =>
  value === "PUE" || value === "PPD" ? value : undefined;

export async function invoiceStudioContext(): Promise<InvoiceStudioContext> {
  const { organizationId } = await requireInvoicePlan();
  const db = getDb();
  const [profile, settings, clients, concepts] = await Promise.all([
    db.fiscalProfile.findUnique({ where: { organizationId } }),
    db.invoiceSettings.findUnique({ where: { organizationId } }),
    db.client.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { legalName: "asc" },
      take: 500,
    }),
    db.savedInvoiceConcept.findMany({
      where: { organizationId, active: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
  ]);
  return {
    issuer: {
      organizationId,
      legalName: profile?.legalName ?? "",
      rfc: profile?.rfc ?? "",
      fiscalRegime: profile?.fiscalRegime ?? "",
      postalCode: profile?.postalCode ?? "",
      email: profile?.email ?? "",
      profileComplete: fiscalProfileComplete(profile),
    },
    settings: {
      prefix: settings?.prefix ?? "ORB",
      ...(settings ? { nextNumberPreview: settings.nextNumber } : {}),
      currencyDefault: settings?.currencyDefault ?? "MXN",
      // Without settings the recommended default applies; stored nulls are respected.
      paymentMethodDefault: settings
        ? paymentMethod(settings.paymentMethodDefault)
        : "PUE",
      ...(settings?.paymentFormDefault
        ? { paymentFormDefault: settings.paymentFormDefault }
        : {}),
      ...(settings
        ? { template: settings.template, color: settings.color }
        : {}),
      logoAvailable: !!settings?.logoDocumentId,
    },
    clients: clients.map(clientDto),
    savedConcepts: concepts.map(savedConceptDto),
    catalogs: invoiceFiscalCatalogs,
  };
}

export async function validateInvoiceDraft(
  input: unknown,
): Promise<ValidateInvoiceDraftResponse> {
  const { organizationId, userId } = await requireInvoicePlan();
  await enforceRateLimit("draft-validate:" + userId, 120, 60);
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success)
    return {
      totals: null,
      validation: buildValidationResult(
        issuesFromStructure(parsed.error.issues),
      ),
    };
  const data = parsed.data,
    totals = calculateInvoiceTotals(data.concepts);
  if (!amountsInRange(totals))
    return {
      totals: null,
      validation: buildValidationResult([outOfRangeIssue]),
    };
  const refs = await loadDraftRefs(getDb(), organizationId, data);
  return {
    totals: serializeInvoiceTotals(totals),
    validation: evaluateDraft(
      data,
      refs,
      totals,
      missingSavedIssues(data, refs.missingSaved),
    ),
  };
}

function idempotencyKey(value: string | null | undefined) {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value))
    throw new InvoiceApiError(
      400,
      "Idempotency-Key debe tener de 8 a 128 caracteres alfanuméricos, guiones o guiones bajos.",
      "INVALID_IDEMPOTENCY_KEY",
    );
  return value;
}
function storedSaveResponse(invoice: StoredInvoice) {
  return saveResponse(
    invoice,
    storedTotals(invoice),
    invoice.validation as unknown as InvoiceValidationResult,
  );
}

export async function createInvoiceDraft(
  input: unknown,
  idempotencyHeader?: string | null,
): Promise<{ created: boolean; result: CreateInvoiceDraftResponse }> {
  const { organizationId, userId } = await requireInvoicePlan();
  await enforceRateLimit("draft:" + userId, 30, 60);
  const data = draftSchema.parse(input),
    key = idempotencyKey(idempotencyHeader),
    totals = totalsWithinLimits(data);
  return getDb().$transaction(async (tx) => {
    // Serialize draft creation per tenant on the row that also owns the folio sequence,
    // so a retried Idempotency-Key sees the committed draft (same pattern as billing).
    await tx.$queryRaw`SELECT "organizationId" FROM "InvoiceSettings" WHERE "organizationId"=${organizationId} FOR UPDATE`;
    if (key) {
      const existing = await tx.stampedInvoice.findFirst({
        where: { organizationId, idempotencyKey: key },
        include: orderedConcepts,
      });
      if (existing)
        return { created: false, result: storedSaveResponse(existing) };
    }
    const refs = await loadDraftRefs(tx, organizationId, data);
    if (!refs.profile)
      throw new InvoiceApiError(
        409,
        "Configura el perfil fiscal del emisor antes de facturar.",
        "FISCAL_PROFILE_REQUIRED",
      );
    if (!refs.client)
      throw new InvoiceApiError(
        404,
        "Cliente no disponible.",
        "CLIENT_NOT_AVAILABLE",
      );
    if (refs.missingSaved.size)
      throw new InvoiceApiError(
        404,
        "Concepto guardado no disponible.",
        "SAVED_CONCEPT_NOT_AVAILABLE",
      );
    const configured = await tx.invoiceSettings.findUnique({
      where: { organizationId },
    });
    if (!configured?.logoDocumentId)
      throw new InvoiceApiError(
        409,
        "Configura el logo y la administración de facturas.",
        "INVOICE_SETTINGS_REQUIRED",
      );
    // Contract §7: fiscal errors are stored with the draft; they only block READY.
    const validation = evaluateDraft(data, refs, totals);
    // Atomic row update allocates one sequence per tenant, even for simultaneous requests.
    const settings = await tx.invoiceSettings.update({
      where: { organizationId },
      data: { nextNumber: { increment: 1 } },
    });
    const sequence = settings.nextNumber - 1;
    if (sequence > 999999999)
      throw new InvoiceApiError(
        409,
        "Secuencia agotada.",
        "SEQUENCE_EXHAUSTED",
      );
    const invoice = await tx.stampedInvoice.create({
      data: {
        organizationId,
        userId,
        status: "DRAFT",
        sequence,
        folio: settings.prefix + "-" + String(sequence).padStart(6, "0"),
        idempotencyKey: key,
        ...draftFields(data, refs.profile, refs.client, totals, validation),
        templateSnapshot: templateSnapshot(settings),
        concepts: { create: conceptRows(data, totals) },
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_DRAFT_CREATED",
        entityType: "StampedInvoice",
        entityId: invoice.id,
      },
    });
    return {
      created: true,
      result: saveResponse(invoice, serializeInvoiceTotals(totals), validation),
    };
  });
}

const draftConflict = () =>
  new InvoiceApiError(
    409,
    "El borrador cambió en otra sesión. Recárgalo antes de guardar.",
    "DRAFT_CONFLICT",
  );

export async function updateInvoiceDraft(
  id: string,
  input: unknown,
): Promise<CreateInvoiceDraftResponse> {
  const { organizationId, userId } = await requireInvoicePlan();
  await enforceRateLimit("draft-update:" + userId, 60, 60);
  const { expectedUpdatedAt, ...data } = updateDraftSchema.parse(input);
  const totals = totalsWithinLimits(data);
  return getDb().$transaction(async (tx) => {
    const current = await tx.stampedInvoice.findFirst({
      where: { id, organizationId },
      select: { status: true, updatedAt: true },
    });
    if (!current)
      throw new InvoiceApiError(
        404,
        "Factura no disponible.",
        "INVOICE_NOT_FOUND",
      );
    if (current.status !== "DRAFT" && current.status !== "READY")
      throw new InvoiceApiError(
        409,
        "Solo se pueden editar borradores.",
        "INVOICE_NOT_EDITABLE",
      );
    if (current.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime())
      throw draftConflict();
    const refs = await loadDraftRefs(tx, organizationId, data);
    if (!refs.profile)
      throw new InvoiceApiError(
        409,
        "Configura el perfil fiscal del emisor antes de facturar.",
        "FISCAL_PROFILE_REQUIRED",
      );
    if (!refs.client)
      throw new InvoiceApiError(
        404,
        "Cliente no disponible.",
        "CLIENT_NOT_AVAILABLE",
      );
    if (refs.missingSaved.size)
      throw new InvoiceApiError(
        404,
        "Concepto guardado no disponible.",
        "SAVED_CONCEPT_NOT_AVAILABLE",
      );
    const settings = await tx.invoiceSettings.findUnique({
      where: { organizationId },
    });
    const validation = evaluateDraft(data, refs, totals);
    // Conditional write: a concurrent save changes updatedAt and makes this one conflict.
    // Editing a READY invoice returns it to DRAFT until it is validated again (§6, §21).
    const updated = await tx.stampedInvoice.updateMany({
      where: {
        id,
        organizationId,
        status: current.status,
        updatedAt: current.updatedAt,
      },
      data: {
        ...draftFields(data, refs.profile, refs.client, totals, validation),
        ...(settings ? { templateSnapshot: templateSnapshot(settings) } : {}),
        status: "DRAFT",
        readyAt: null,
        updatedAt: new Date(),
      },
    });
    if (!updated.count) throw draftConflict();
    await tx.stampedInvoiceConcept.deleteMany({
      where: { stampedInvoiceId: id },
    });
    await tx.stampedInvoiceConcept.createMany({
      data: conceptRows(data, totals).map((row) => ({
        ...row,
        stampedInvoiceId: id,
      })),
    });
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_DRAFT_UPDATED",
        entityType: "StampedInvoice",
        entityId: id,
      },
    });
    const invoice = await tx.stampedInvoice.findUniqueOrThrow({
      where: { id },
    });
    return saveResponse(invoice, serializeInvoiceTotals(totals), validation);
  });
}

export async function markInvoiceReady(
  id: string,
  input: unknown,
): Promise<CreateInvoiceDraftResponse> {
  const { organizationId, userId } = await requireInvoicePlan();
  await enforceRateLimit("draft-ready:" + userId, 30, 60);
  const { expectedUpdatedAt } = readyRequestSchema.parse(input ?? {});
  return getDb().$transaction(async (tx) => {
    const invoice = await tx.stampedInvoice.findFirst({
      where: { id, organizationId },
      include: orderedConcepts,
    });
    if (!invoice)
      throw new InvoiceApiError(
        404,
        "Factura no disponible.",
        "INVOICE_NOT_FOUND",
      );
    if (
      expectedUpdatedAt &&
      invoice.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
    )
      throw draftConflict();
    const validation = await validateStoredInvoice(tx, organizationId, invoice);
    if (invoice.status === "READY")
      return saveResponse(invoice, storedTotals(invoice), validation);
    if (invoice.status !== "DRAFT")
      throw new InvoiceApiError(
        409,
        "Solo un borrador puede marcarse como listo.",
        "INVOICE_NOT_EDITABLE",
      );
    if (!validation.canMarkReady)
      throw new InvoiceApiError(
        422,
        invoice.documentType === "I"
          ? "Corrige los errores fiscales antes de marcar la factura como lista."
          : "Solo las facturas de Ingreso pueden quedar listas en este sprint.",
        "NOT_READY",
        validation,
      );
    const readyAt = new Date();
    const updated = await tx.stampedInvoice.updateMany({
      where: {
        id,
        organizationId,
        status: "DRAFT",
        updatedAt: invoice.updatedAt,
      },
      data: {
        status: "READY",
        readyAt,
        validation: json(validation),
        updatedAt: readyAt,
      },
    });
    if (!updated.count) throw draftConflict();
    await tx.activityLog.create({
      data: {
        organizationId,
        userId,
        action: "INVOICE_MARKED_READY",
        entityType: "StampedInvoice",
        entityId: id,
      },
    });
    return saveResponse(
      { ...invoice, status: "READY", updatedAt: readyAt },
      storedTotals(invoice),
      validation,
    );
  });
}

export async function getInvoiceDraftDetail(
  id: string,
): Promise<InvoiceDraftDetail> {
  const { organizationId } = await requireInvoicePlan();
  const db = getDb();
  const invoice = await db.stampedInvoice.findFirst({
    where: { id, organizationId },
    include: orderedConcepts,
  });
  if (!invoice)
    throw new InvoiceApiError(
      404,
      "Factura no disponible.",
      "INVOICE_NOT_FOUND",
    );
  const totals = storedTotals(invoice);
  return {
    id: invoice.id,
    folio: invoice.folio,
    status: invoice.status,
    uuid: invoice.uuid,
    clientId: invoice.clientId,
    invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
    documentType: invoice.documentType,
    currency: invoice.currency,
    ...(invoice.exchangeRate
      ? { exchangeRate: invoice.exchangeRate.toString() }
      : {}),
    cfdiUse: invoice.cfdiUse,
    ...(paymentMethod(invoice.paymentMethod)
      ? { paymentMethod: paymentMethod(invoice.paymentMethod) }
      : {}),
    ...(invoice.paymentForm ? { paymentForm: invoice.paymentForm } : {}),
    exportCode: invoice.exportCode,
    issuerSnapshot: readSnapshot(invoice.issuerSnapshot),
    receiverSnapshot: readSnapshot(invoice.receiverSnapshot),
    concepts: invoice.concepts.map((c, position) => ({
      ...storedConcept(c),
      position,
    })),
    totals,
    validation: await validateStoredInvoice(db, organizationId, invoice),
    readyAt: invoice.readyAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    subtotal: totals.subtotal,
    tax: totals.transferredTaxes,
    total: totals.total,
  };
}

// Prisma row with Decimal fields, used by the existing draft preview page.
export async function getOutgoingInvoice(id: string) {
  const { organizationId } = await requireInvoicePlan();
  const result = await getDb().stampedInvoice.findFirst({
    where: { id, organizationId },
    include: orderedConcepts,
  });
  if (!result) throw new ApiError(404, "Factura no disponible.");
  return result;
}
export async function issuedInvoices() {
  const { organizationId } = await requireInvoicePlan();
  return getDb().stampedInvoice.findMany({
    where: {
      organizationId,
      status: "ISSUED",
      uuid: { not: null },
      issuedAt: { not: null },
    },
    orderBy: { issuedAt: "desc" },
    take: 500,
  });
}
