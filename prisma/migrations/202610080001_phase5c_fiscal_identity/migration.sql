-- CreateEnum
CREATE TYPE "FiscalConsentPurpose" AS ENUM ('FISCAL_PROFILE_PREFILL', 'CLIENT_FISCAL_PREFILL');

-- CreateEnum
CREATE TYPE "FiscalExtractionStatus" AS ENUM ('PROCESSED', 'PARTIAL', 'UNREADABLE');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "csfDocumentId" TEXT,
ADD COLUMN     "sourceExtractionId" TEXT;

-- AlterTable
ALTER TABLE "FiscalProfile" ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "sourceExtractionId" TEXT;

-- AlterTable
ALTER TABLE "StampedInvoice" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "FiscalDocumentConsent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "purpose" "FiscalConsentPurpose" NOT NULL,
    "clientId" TEXT,
    "consentVersion" TEXT NOT NULL,
    "privacyNoticeVersion" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalDocumentConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDocumentExtraction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "purpose" "FiscalConsentPurpose" NOT NULL,
    "clientId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" "FiscalExtractionStatus" NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "regimes" JSONB NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalDocumentExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalDocumentConsent_organizationId_documentId_idx" ON "FiscalDocumentConsent"("organizationId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocumentConsent_organizationId_id_key" ON "FiscalDocumentConsent"("organizationId", "id");

-- CreateIndex
CREATE INDEX "FiscalDocumentExtraction_organizationId_documentId_createdA_idx" ON "FiscalDocumentExtraction"("organizationId", "documentId", "createdAt");

-- CreateIndex
CREATE INDEX "FiscalDocumentExtraction_organizationId_consentId_idx" ON "FiscalDocumentExtraction"("organizationId", "consentId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocumentExtraction_organizationId_id_key" ON "FiscalDocumentExtraction"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_organizationId_sourceExtractionId_fkey" FOREIGN KEY ("organizationId", "sourceExtractionId") REFERENCES "FiscalDocumentExtraction"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_csfDocumentId_fkey" FOREIGN KEY ("organizationId", "csfDocumentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_sourceExtractionId_fkey" FOREIGN KEY ("organizationId", "sourceExtractionId") REFERENCES "FiscalDocumentExtraction"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocumentConsent" ADD CONSTRAINT "FiscalDocumentConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocumentConsent" ADD CONSTRAINT "FiscalDocumentConsent_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocumentConsent" ADD CONSTRAINT "FiscalDocumentConsent_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "Client"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocumentExtraction" ADD CONSTRAINT "FiscalDocumentExtraction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocumentExtraction" ADD CONSTRAINT "FiscalDocumentExtraction_organizationId_consentId_fkey" FOREIGN KEY ("organizationId", "consentId") REFERENCES "FiscalDocumentConsent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocumentExtraction" ADD CONSTRAINT "FiscalDocumentExtraction_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
