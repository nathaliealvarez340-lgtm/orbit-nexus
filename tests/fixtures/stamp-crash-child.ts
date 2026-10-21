// Process A of tests/cfdi40-stamp-crash-recovery.test.ts (Fase 5C.8 crash-safe recovery).
// Opens the PERSISTENT PGlite at argv[2], stamps one SYNTHETIC invoice through the real
// service and the real SW adapter, and dies abruptly (exit 99) right after the simulated PAC
// received the request: no response is read, nothing is finalized, nothing is closed. What
// the PAC received (CustomID, SHA-256 and bytes of the xml part) goes to argv[3] so process B
// can compare it with what it recovers from the database. Never a real PAC, CSD or token.
import { writeFileSync } from "node:fs";
import { X509Certificate, createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../src/generated/prisma/client";
import { resolveCustody } from "../../src/lib/csd/custody";
import { csdCustodyTerms } from "../../src/lib/csd/custody-terms";
import { createSwPacAdapter } from "../../src/lib/pac/sw/adapter";
import { resolveSwPacConfiguration } from "../../src/lib/pac/sw/config";
import { stampAuthorizationTerms } from "../../src/lib/stamping/terms";
import { stampInvoice } from "../../src/services/cfdi40-stamp";
import { configureCsd } from "../../src/services/csd-store";
import type { InvoiceValidationResult } from "../../src/types/invoice-studio";
import { startDatabase } from "../../scripts/local-database.mjs";
import { issuedAt, validFixtures } from "./cfdi40";
import { readMultipart } from "./stamping";
import { syntheticAuthority, syntheticCsd } from "./synthetic-csd.mjs";

const [dataDir, receivedFile] = process.argv.slice(2);
const env = {
  PAC_ENVIRONMENT: "SANDBOX",
  STAMPING_ENABLED: "true",
  SW_SANDBOX_TOKEN: process.env.CRASH_TEST_TOKEN,
  CSD_KEY_PROVIDER_SANDBOX: "env",
  CSD_KEK_ID: "orbit-crash-test",
  CSD_KEK_CURRENT_VERSION: "1",
  CSD_KEK_V1: process.env.CRASH_TEST_KEK,
};
const authority = syntheticAuthority();
const custody = resolveCustody(env, [
  new X509Certificate(authority.certificate),
]);
const material = syntheticCsd(authority, {
  rfc: "SCA010101AB1",
  certificateNumber: "30001000000000000001",
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2036-01-01T00:00:00Z"),
});
const owner = {
  organizationId: "org-crash",
  userId: "owner-crash",
  role: "OWNER" as const,
};

async function main() {
  const database = await startDatabase(dataDir);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.url, max: 5 }),
  });
  await database.db.exec(`
    INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('owner-crash','Owner','owner-crash@example.test',NOW());
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-crash','Org Crash',NOW());
    INSERT INTO "FiscalProfile" (id,"userId","organizationId",rfc,"legalName","fiscalRegime","postalCode","cfdiUse",email,"confirmedAt","updatedAt") VALUES
      ('fp-crash','owner-crash','org-crash','SCA010101AB1','EMPRESA SINTETICA DE PRUEBAS','601','06600','G03','a@example.test',NOW(),NOW());
    INSERT INTO "StampingEntitlement" ("organizationId",environment,enabled,"updatedAt") VALUES ('org-crash','SANDBOX',true,NOW());`);
  await configureCsd(
    prisma,
    owner,
    {
      certificate: {
        name: "csd.cer",
        bytes: Buffer.from(material.certificate),
      },
      privateKey: { name: "csd.key", bytes: Buffer.from(material.privateKey) },
      password: material.password,
      custodyTermsVersion: csdCustodyTerms.version,
      accepted: true,
      replace: false,
      expectedActiveCsdId: null,
    },
    custody,
    issuedAt,
    env,
  );
  const f = validFixtures["ingreso-pue-iva16"].invoice();
  await prisma.stampedInvoice.create({
    data: {
      id: "inv-crash",
      organizationId: "org-crash",
      userId: "owner-crash",
      status: "READY",
      version: 1,
      folio: "ORB-000001",
      invoiceDate: new Date(f.invoiceDate + "T00:00:00Z"),
      currency: f.currency,
      documentType: f.documentType,
      cfdiUse: f.cfdiUse,
      paymentMethod: f.paymentMethod,
      paymentForm: f.paymentForm,
      exportCode: f.exportCode,
      issuerSnapshot: f.issuerSnapshot as Prisma.InputJsonValue,
      receiverSnapshot: f.receiverSnapshot as Prisma.InputJsonValue,
      issuerRfc: "SCA010101AB1",
      receiverRfc: (f.receiverSnapshot as { rfc: string }).rfc,
      subtotal: f.totals.subtotal,
      discount: f.totals.discount,
      tax: f.totals.transferred,
      withheldVat: f.totals.withheldVat,
      withheldIsr: f.totals.withheldIsr,
      total: f.totals.total,
      validation: { canMarkReady: true },
      readyAt: issuedAt,
      concepts: {
        create: f.concepts.map((c) => ({
          position: c.position,
          description: c.description,
          productCode: c.productCode,
          unitCode: c.unitCode,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          discount: c.discount,
          taxObject: c.taxObject,
          vatFactor: c.vatFactor,
          vatRate: c.vatRate,
          taxRate: c.appliedVatRate,
          withholdingVatRate: c.withholdingVatRate,
          withholdingIsrRate: c.withholdingIsrRate,
          subtotal: c.totals.amount,
          transferredTaxes: c.totals.transferred,
          withheldVat: c.totals.withheldVat,
          withheldIsr: c.totals.withheldIsr,
          total: c.totals.amount,
        })),
      },
    },
  });

  const pac = createSwPacAdapter(resolveSwPacConfiguration(env), {
    // The PAC receives the request (and, as far as ORBIT can tell, may stamp it); this process
    // dies before any response exists.
    transport: async (_url, init) => {
      const parts = readMultipart(init);
      writeFileSync(
        receivedFile,
        JSON.stringify({
          wellFormed: parts.wellFormed,
          customId: parts.customId,
          sha256: createHash("sha256").update(parts.xml).digest("hex"),
          xml: Buffer.from(parts.xml).toString("base64"),
        }),
      );
      process.exit(99);
    },
  });
  await stampInvoice(
    prisma,
    owner,
    "inv-crash",
    {
      expectedVersion: 1,
      authorization: {
        accepted: true,
        version: stampAuthorizationTerms.version,
      },
    },
    {
      env,
      clock: () => issuedAt,
      custody,
      pac,
      revalidate: async () =>
        ({
          canMarkReady: true,
          issues: [],
        }) as unknown as InvoiceValidationResult,
    },
  );
  // Unreachable: the transport exits the process.
}

// Reaching the end means the PAC was never called: a failure the parent reports.
main().then(
  () => process.exit(1),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
