-- Fase 5C.8 (docs/tasks/FASE5C8-PAC-SANDBOX.md §5-9, §29): additive only. New tables for the
-- per-invoice stamping authorization, the PAC stamping attempts and the operator-managed
-- stamping entitlement; no existing table or column changes. Local only: NOT applied to Neon.

-- CreateEnum
CREATE TYPE "StampAttemptStatus" AS ENUM ('PENDING', 'SIGNING', 'SUBMITTING', 'WAITING_PROVIDER', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "StampFailureClass" AS ENUM ('PRE_SUBMIT', 'REJECTED_RETRYABLE', 'REJECTED_FINAL');

-- CreateTable
CREATE TABLE "StampingEntitlement" (
    "organizationId" TEXT NOT NULL,
    "environment" "PacEnvironment" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StampingEntitlement_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "StampAuthorization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceVersion" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "termsSha256" CHAR(64) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StampAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StampAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceVersion" INTEGER NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "environment" "PacEnvironment" NOT NULL,
    "customId" TEXT NOT NULL,
    "activeKey" TEXT,
    "succeededKey" TEXT,
    "status" "StampAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "failureClass" "StampFailureClass",
    "resultCode" TEXT,
    "detailCode" TEXT,
    "providerCode" TEXT,
    "providerMessage" TEXT,
    "requestSha256" CHAR(64),
    "preSealSha256" CHAR(64),
    "originalStringSha256" CHAR(64),
    "sealedXml" BYTEA,
    "uuid" TEXT,
    "stampedSha256" CHAR(64),
    "stampedXml" BYTEA,
    "stampedAt" TEXT,
    "rfcProvCertif" TEXT,
    "noCertificadoSat" TEXT,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StampAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StampAuthorization_organizationId_invoiceId_acceptedAt_idx" ON "StampAuthorization"("organizationId", "invoiceId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StampAuthorization_organizationId_id_key" ON "StampAuthorization"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StampAttempt_authorizationId_key" ON "StampAttempt"("authorizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StampAttempt_customId_key" ON "StampAttempt"("customId");

-- CreateIndex
CREATE UNIQUE INDEX "StampAttempt_activeKey_key" ON "StampAttempt"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "StampAttempt_succeededKey_key" ON "StampAttempt"("succeededKey");

-- CreateIndex
CREATE UNIQUE INDEX "StampAttempt_uuid_key" ON "StampAttempt"("uuid");

-- CreateIndex
CREATE INDEX "StampAttempt_organizationId_invoiceId_startedAt_idx" ON "StampAttempt"("organizationId", "invoiceId", "startedAt");

-- CreateIndex
CREATE INDEX "StampAttempt_organizationId_status_idx" ON "StampAttempt"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StampAttempt_organizationId_id_key" ON "StampAttempt"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StampAttempt_organizationId_authorizationId_key" ON "StampAttempt"("organizationId", "authorizationId");

-- AddForeignKey
ALTER TABLE "StampingEntitlement" ADD CONSTRAINT "StampingEntitlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampAuthorization" ADD CONSTRAINT "StampAuthorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampAuthorization" ADD CONSTRAINT "StampAuthorization_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "StampedInvoice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampAttempt" ADD CONSTRAINT "StampAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampAttempt" ADD CONSTRAINT "StampAttempt_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "StampedInvoice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampAttempt" ADD CONSTRAINT "StampAttempt_organizationId_authorizationId_fkey" FOREIGN KEY ("organizationId", "authorizationId") REFERENCES "StampAuthorization"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint (not representable in the Prisma schema): the UUID is stored only in its
-- canonical lowercase form, so the unique index above is effectively case-insensitive and the
-- same fiscal UUID can never be recorded twice with different letter case.
ALTER TABLE "StampAttempt" ADD CONSTRAINT "StampAttempt_uuid_canonical_check" CHECK ("uuid" IS NULL OR "uuid" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
