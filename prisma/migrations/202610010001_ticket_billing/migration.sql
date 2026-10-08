-- CreateEnum
CREATE TYPE "BillingAttemptStatus" AS ENUM ('PREPARING', 'AWAITING_APPROVAL', 'SUBMITTING', 'WAITING_PROVIDER', 'SUCCEEDED', 'FAILED', 'NEEDS_MANUAL_ACTION', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BillingStatus" ADD VALUE 'BILLING_REVIEW';
ALTER TYPE "BillingStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "BillingStatus" ADD VALUE 'NEEDS_MANUAL_ACTION';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billingAttemptId" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "adapterKey" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "automationMode" TEXT NOT NULL DEFAULT 'ASSISTED',
ADD COLUMN     "domain" TEXT,
ADD COLUMN     "merchantRfc" TEXT,
ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "OrganizationBillingProvider" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "merchantRfc" TEXT,
    "domain" TEXT NOT NULL,
    "customBillingUrl" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationBillingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "BillingAttemptStatus" NOT NULL DEFAULT 'PREPARING',
    "activeKey" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "billingUrl" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "contextHash" TEXT NOT NULL,
    "missingFields" JSONB,
    "errorCode" TEXT,
    "errorCategory" TEXT,
    "remoteSession" TEXT,
    "approvalHash" TEXT,
    "approvalExpiresAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAttemptEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAttemptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationBillingProvider_organizationId_id_key" ON "OrganizationBillingProvider"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationBillingProvider_organizationId_domain_key" ON "OrganizationBillingProvider"("organizationId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_activeKey_key" ON "BillingAttempt"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_idempotencyKey_key" ON "BillingAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingAttempt_organizationId_ticketId_createdAt_idx" ON "BillingAttempt"("organizationId", "ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_organizationId_id_key" ON "BillingAttempt"("organizationId", "id");

-- CreateIndex
CREATE INDEX "BillingAttemptEvent_organizationId_attemptId_createdAt_idx" ON "BillingAttemptEvent"("organizationId", "attemptId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_billingAttemptId_key" ON "Invoice"("billingAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_billingAttemptId_key" ON "Invoice"("organizationId", "billingAttemptId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_billingAttemptId_fkey" FOREIGN KEY ("organizationId", "billingAttemptId") REFERENCES "BillingAttempt"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationBillingProvider" ADD CONSTRAINT "OrganizationBillingProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationBillingProvider" ADD CONSTRAINT "OrganizationBillingProvider_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAttempt" ADD CONSTRAINT "BillingAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAttempt" ADD CONSTRAINT "BillingAttempt_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "Ticket"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAttempt" ADD CONSTRAINT "BillingAttempt_organizationId_providerId_fkey" FOREIGN KEY ("organizationId", "providerId") REFERENCES "OrganizationBillingProvider"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAttemptEvent" ADD CONSTRAINT "BillingAttemptEvent_organizationId_attemptId_fkey" FOREIGN KEY ("organizationId", "attemptId") REFERENCES "BillingAttempt"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend the existing merchant catalog; all initial providers remain assisted.
INSERT INTO "Company" (id,slug,name,"portalUrl",compatibility,"requiredFields",rules,domain,"adapterKey","updatedAt") VALUES
 ('portal-oxxo','oxxo','OXXO','https://www4.oxxo.com/facturacionElectronica-web/views/layout/inicio.do','ASSISTED','["purchaseDate","folio","operationNumber","total"]','{}','www4.oxxo.com','manual',CURRENT_TIMESTAMP),
 ('portal-walmart','walmart','Walmart','https://facturacion-clientes.walmart.com/','ASSISTED','["ticketNumber","operationNumber"]','{}','facturacion-clientes.walmart.com','manual',CURRENT_TIMESTAMP),
 ('portal-costco','costco','Costco','https://www.costco.com.mx/facturacion','ASSISTED','["ticketNumber"]','{}','www.costco.com.mx','manual',CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;
