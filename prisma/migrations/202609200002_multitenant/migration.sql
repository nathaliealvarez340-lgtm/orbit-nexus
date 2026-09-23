-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('NOT_REQUESTED', 'READY', 'REQUIRES_DATA', 'REDIRECT_REQUIRED', 'PROCESSING', 'INVOICED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketStatus" ADD VALUE 'REVIEW';
ALTER TYPE "TicketStatus" ADD VALUE 'REGISTERED';

-- DropForeignKey
ALTER TABLE "TicketExtractedData" DROP CONSTRAINT "TicketExtractedData_ticketId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_ticketId_fkey";

-- DropIndex
DROP INDEX "FiscalProfile_userId_key";

-- DropIndex
DROP INDEX "FiscalProfile_rfc_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "image" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FiscalProfile" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "personType" "UserType" NOT NULL DEFAULT 'COMPANY';

-- AlterTable
ALTER TABLE "UploadedFiscalDocument" ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "billingStatus" "BillingStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "merchant" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TicketExtractedData" ADD COLUMN     "organizationId" TEXT,
ALTER COLUMN "confidence" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "issuerName" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "pdfDocumentId" TEXT,
ADD COLUMN     "uuid" TEXT,
ADD COLUMN     "xmlDocumentId" TEXT;

-- AlterTable
ALTER TABLE "StampedInvoice" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "capturedById" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "purchaseDate" DATE NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2),
    "tax" DECIMAL(12,2),
    "category" TEXT,
    "folio" TEXT,
    "details" JSONB,
    "billingStatus" "BillingStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Preserve legacy records in an initial organization per user.
INSERT INTO "Organization" ("id", "name", "updatedAt") SELECT 'legacy_' || "id", "name" || ' · Organización', CURRENT_TIMESTAMP FROM "User";
INSERT INTO "Membership" ("id", "organizationId", "userId", "role") SELECT 'legacy_member_' || "id", 'legacy_' || "id", "id", 'OWNER' FROM "User";
UPDATE "FiscalProfile" SET "organizationId" = 'legacy_' || "userId", "personType" = CASE WHEN length("rfc") = 13 THEN 'INDIVIDUAL'::"UserType" ELSE 'COMPANY'::"UserType" END;
UPDATE "UploadedFiscalDocument" SET "organizationId" = 'legacy_' || "userId";
UPDATE "Ticket" SET "organizationId" = 'legacy_' || "userId";
UPDATE "TicketExtractedData" e SET "organizationId" = t."organizationId" FROM "Ticket" t WHERE e."ticketId" = t."id";
UPDATE "Invoice" SET "organizationId" = 'legacy_' || "userId";
UPDATE "StampedInvoice" SET "organizationId" = 'legacy_' || "userId";
UPDATE "ActivityLog" SET "organizationId" = 'legacy_' || "userId" WHERE "userId" IS NOT NULL;
INSERT INTO "Organization" ("id", "name", "updatedAt") SELECT 'legacy_audit_archive', 'Archivo de auditoría', CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "ActivityLog" WHERE "organizationId" IS NULL);
UPDATE "ActivityLog" SET "organizationId" = 'legacy_audit_archive' WHERE "organizationId" IS NULL;
ALTER TABLE "FiscalProfile" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "UploadedFiscalDocument" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TicketExtractedData" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "StampedInvoice" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ActivityLog" ALTER COLUMN "organizationId" SET NOT NULL;
-- Legacy hashes are retained, not guessed or imported into Better Auth.
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "RequestLimit_expiresAt_idx" ON "RequestLimit"("expiresAt");

-- CreateIndex
CREATE INDEX "Document_organizationId_createdAt_idx" ON "Document"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_id_key" ON "Document"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_ticketId_key" ON "Expense"("ticketId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_purchaseDate_idx" ON "Expense"("organizationId", "purchaseDate");

-- CreateIndex
CREATE INDEX "Expense_organizationId_billingStatus_idx" ON "Expense"("organizationId", "billingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_ticketId_key" ON "Expense"("organizationId", "ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_id_key" ON "Expense"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalProfile_organizationId_key" ON "FiscalProfile"("organizationId");

-- CreateIndex
CREATE INDEX "Ticket_organizationId_createdAt_idx" ON "Ticket"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_organizationId_id_key" ON "Ticket"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TicketExtractedData_organizationId_ticketId_key" ON "TicketExtractedData"("organizationId", "ticketId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_createdAt_idx" ON "Invoice"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_ticketId_key" ON "Invoice"("organizationId", "ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_uuid_key" ON "Invoice"("organizationId", "uuid");

-- CreateIndex
CREATE INDEX "ActivityLog_organizationId_createdAt_idx" ON "ActivityLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "Ticket"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedFiscalDocument" ADD CONSTRAINT "UploadedFiscalDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedFiscalDocument" ADD CONSTRAINT "UploadedFiscalDocument_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketExtractedData" ADD CONSTRAINT "TicketExtractedData_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "Ticket"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_xmlDocumentId_fkey" FOREIGN KEY ("organizationId", "xmlDocumentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_pdfDocumentId_fkey" FOREIGN KEY ("organizationId", "pdfDocumentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "Ticket"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampedInvoice" ADD CONSTRAINT "StampedInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

