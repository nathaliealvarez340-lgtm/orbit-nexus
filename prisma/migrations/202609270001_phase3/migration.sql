-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO', 'MAX');

-- CreateEnum
CREATE TYPE "AccentColor" AS ENUM ('PURPLE', 'BLUE', 'ORANGE', 'RED');

-- AlterTable
ALTER TABLE "FiscalProfile" ADD COLUMN     "colony" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'MEX',
ADD COLUMN     "csfDocumentId" TEXT,
ADD COLUMN     "exteriorNumber" TEXT,
ADD COLUMN     "interiorNumber" TEXT,
ADD COLUMN     "locality" TEXT,
ADD COLUMN     "municipality" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street" TEXT;

-- AlterTable
ALTER TABLE "StampedInvoice" ADD COLUMN     "cfdiUse" TEXT,
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'MXN',
ADD COLUMN     "documentType" TEXT NOT NULL DEFAULT 'I',
ADD COLUMN     "folio" TEXT,
ADD COLUMN     "invoiceDate" DATE,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "issuerSnapshot" JSONB,
ADD COLUMN     "paymentForm" TEXT,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "pdfDocumentId" TEXT,
ADD COLUMN     "receiverSnapshot" JSONB,
ADD COLUMN     "sequence" INTEGER,
ADD COLUMN     "templateSnapshot" JSONB,
ADD COLUMN     "xmlDocumentId" TEXT;

-- AlterTable
ALTER TABLE "StampedInvoiceConcept" ADD COLUMN     "productCode" TEXT NOT NULL DEFAULT '01010101',
ADD COLUMN     "unitCode" TEXT NOT NULL DEFAULT 'ACT';

-- CreateTable
CREATE TABLE "Subscription" (
    "organizationId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL,
    "accent" "AccentColor" NOT NULL DEFAULT 'PURPLE',

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "personType" "UserType" NOT NULL DEFAULT 'COMPANY',
    "internalNumber" TEXT,
    "foreignTaxId" TEXT,
    "fiscalRegime" TEXT NOT NULL,
    "cfdiUse" TEXT NOT NULL,
    "defaultPaymentForm" TEXT NOT NULL DEFAULT '99',
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "additionalEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "postalCode" TEXT NOT NULL,
    "street" TEXT,
    "exteriorNumber" TEXT,
    "interiorNumber" TEXT,
    "colony" TEXT,
    "locality" TEXT,
    "municipality" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'MEX',
    "reference" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSettings" (
    "organizationId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT 'ORB',
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "color" TEXT NOT NULL DEFAULT '#8b5cf6',
    "template" TEXT NOT NULL DEFAULT 'CLASSIC',
    "logoDocumentId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "MonthlyExpenseReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "total" DECIMAL(16,2) NOT NULL,
    "ticketCount" INTEGER NOT NULL,
    "invoiceCount" INTEGER NOT NULL,
    "pendingCount" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyExpenseReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "organizationId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE INDEX "Client_organizationId_archivedAt_idx" ON "Client"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_id_key" ON "Client"("organizationId", "id");

-- CreateIndex
CREATE INDEX "MonthlyExpenseReport_organizationId_createdAt_idx" ON "MonthlyExpenseReport"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyExpenseReport_organizationId_year_month_key" ON "MonthlyExpenseReport"("organizationId", "year", "month");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_organizationId_id_key" ON "Notification"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_organizationId_eventKey_key" ON "Notification"("organizationId", "eventKey");

-- CreateIndex
CREATE INDEX "StampedInvoice_organizationId_issuedAt_idx" ON "StampedInvoice"("organizationId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StampedInvoice_organizationId_id_key" ON "StampedInvoice"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StampedInvoice_organizationId_folio_key" ON "StampedInvoice"("organizationId", "folio");

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_organizationId_csfDocumentId_fkey" FOREIGN KEY ("organizationId", "csfDocumentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampedInvoice" ADD CONSTRAINT "StampedInvoice_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "Client"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampedInvoice" ADD CONSTRAINT "StampedInvoice_organizationId_xmlDocumentId_fkey" FOREIGN KEY ("organizationId", "xmlDocumentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampedInvoice" ADD CONSTRAINT "StampedInvoice_organizationId_pdfDocumentId_fkey" FOREIGN KEY ("organizationId", "pdfDocumentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSettings" ADD CONSTRAINT "InvoiceSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSettings" ADD CONSTRAINT "InvoiceSettings_organizationId_logoDocumentId_fkey" FOREIGN KEY ("organizationId", "logoDocumentId") REFERENCES "Document"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyExpenseReport" ADD CONSTRAINT "MonthlyExpenseReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_organizationId_notificationId_fkey" FOREIGN KEY ("organizationId", "notificationId") REFERENCES "Notification"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
