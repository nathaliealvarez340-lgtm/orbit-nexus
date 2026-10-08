-- AlterTable
ALTER TABLE "InvoiceSettings" ADD COLUMN     "currencyDefault" TEXT NOT NULL DEFAULT 'MXN',
ADD COLUMN     "paymentFormDefault" TEXT,
ADD COLUMN     "paymentMethodDefault" TEXT;

-- AlterTable
ALTER TABLE "StampedInvoice" ADD COLUMN     "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "exchangeRate" DECIMAL(14,6),
ADD COLUMN     "exportCode" TEXT NOT NULL DEFAULT '01',
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "validation" JSONB,
ADD COLUMN     "withheldIsr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "withheldVat" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StampedInvoiceConcept" ADD COLUMN     "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "savedConceptId" TEXT,
ADD COLUMN     "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxObject" TEXT NOT NULL DEFAULT '02',
ADD COLUMN     "transferredTaxes" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatFactor" TEXT NOT NULL DEFAULT 'TASA',
ADD COLUMN     "vatRate" DECIMAL(7,6),
ADD COLUMN     "withheldIsr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "withheldVat" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "withholdingIsrRate" DECIMAL(7,6),
ADD COLUMN     "withholdingVatRate" DECIMAL(7,6);

-- CreateTable
CREATE TABLE "SavedInvoiceConcept" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "defaultQuantity" DECIMAL(12,4),
    "unitPrice" DECIMAL(12,2),
    "taxObject" TEXT NOT NULL DEFAULT '02',
    "vatFactor" TEXT NOT NULL DEFAULT 'TASA',
    "vatRate" DECIMAL(7,6),
    "withholdingVatRate" DECIMAL(7,6),
    "withholdingIsrRate" DECIMAL(7,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedInvoiceConcept_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedInvoiceConcept_organizationId_active_name_idx" ON "SavedInvoiceConcept"("organizationId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SavedInvoiceConcept_organizationId_id_key" ON "SavedInvoiceConcept"("organizationId", "id");

-- CreateIndex
CREATE INDEX "StampedInvoice_organizationId_status_updatedAt_idx" ON "StampedInvoice"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StampedInvoice_organizationId_idempotencyKey_key" ON "StampedInvoice"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StampedInvoiceConcept_stampedInvoiceId_position_idx" ON "StampedInvoiceConcept"("stampedInvoiceId", "position");

-- AddForeignKey
ALTER TABLE "SavedInvoiceConcept" ADD CONSTRAINT "SavedInvoiceConcept_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill (non-destructive): Phase 3 lines were VAT-only with ObjetoImp 02 and TipoFactor Tasa,
-- where total = ROUND(quantity * unitPrice, 2) + VAT.
UPDATE "StampedInvoiceConcept"
SET "subtotal" = ROUND("quantity" * "unitPrice", 2),
    "transferredTaxes" = "total" - ROUND("quantity" * "unitPrice", 2),
    "vatRate" = "taxRate";

-- Preserve a stable display order for existing lines.
UPDATE "StampedInvoiceConcept" AS c
SET "position" = ordered."position"
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "stampedInvoiceId" ORDER BY "id") - 1)::int AS "position"
  FROM "StampedInvoiceConcept"
) AS ordered
WHERE c."id" = ordered."id";
