-- Fase 5C.3 (docs/tasks/FASE5C3-CONTRACT.md sections E and F): additive only. New tables for CSD
-- metadata and the encrypted private key envelope; no existing table or column changes.

-- CreateEnum
CREATE TYPE "PacEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "CsdCertificateStatus" AS ENUM ('ACTIVE', 'REPLACED', 'DISABLED');

-- CreateTable
CREATE TABLE "CsdCertificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "CsdCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeOrganizationId" TEXT,
    "environment" "PacEnvironment" NOT NULL,
    "certificateDer" BYTEA NOT NULL,
    "certificateSha256" TEXT NOT NULL,
    "serialNumberHex" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "publicKeyAlgorithm" TEXT NOT NULL,
    "publicKeyBits" INTEGER NOT NULL,
    "signatureAlgorithm" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "csdTypeVerifiedLocally" BOOLEAN NOT NULL DEFAULT false,
    "custodyConsentVersion" TEXT NOT NULL,
    "configuredById" TEXT,
    "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsdCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsdPrivateKey" (
    "csdCertificateId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "envelopeVersion" INTEGER NOT NULL,
    "algorithm" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "wrappedDek" BYTEA NOT NULL,
    "kekProvider" TEXT NOT NULL,
    "kekId" TEXT NOT NULL,
    "kekVersion" INTEGER NOT NULL,
    "aadVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewrappedAt" TIMESTAMP(3),

    CONSTRAINT "CsdPrivateKey_pkey" PRIMARY KEY ("csdCertificateId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CsdCertificate_activeOrganizationId_key" ON "CsdCertificate"("activeOrganizationId");

-- CreateIndex
CREATE INDEX "CsdCertificate_organizationId_status_configuredAt_idx" ON "CsdCertificate"("organizationId", "status", "configuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CsdCertificate_organizationId_id_key" ON "CsdCertificate"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CsdPrivateKey_kekProvider_kekId_kekVersion_idx" ON "CsdPrivateKey"("kekProvider", "kekId", "kekVersion");

-- CreateIndex
CREATE UNIQUE INDEX "CsdPrivateKey_organizationId_csdCertificateId_key" ON "CsdPrivateKey"("organizationId", "csdCertificateId");

-- AddForeignKey
ALTER TABLE "CsdCertificate" ADD CONSTRAINT "CsdCertificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsdCertificate" ADD CONSTRAINT "CsdCertificate_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsdCertificate" ADD CONSTRAINT "CsdCertificate_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsdPrivateKey" ADD CONSTRAINT "CsdPrivateKey_organizationId_csdCertificateId_fkey" FOREIGN KEY ("organizationId", "csdCertificateId") REFERENCES "CsdCertificate"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One ACTIVE CSD per Organization: the unique "activeOrganizationId" marker exists exactly
-- while the row is ACTIVE and always equals its own "organizationId".
ALTER TABLE "CsdCertificate" ADD CONSTRAINT "CsdCertificate_active_marker_check"
  CHECK (("status" = 'ACTIVE') = ("activeOrganizationId" IS NOT NULL));
ALTER TABLE "CsdCertificate" ADD CONSTRAINT "CsdCertificate_active_marker_tenant_check"
  CHECK ("activeOrganizationId" IS NULL OR "activeOrganizationId" = "organizationId");
