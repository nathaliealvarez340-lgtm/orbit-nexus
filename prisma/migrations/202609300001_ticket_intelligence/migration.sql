-- Phase 4A: additive ticket extraction audit; no existing rows are rewritten.
ALTER TYPE "TicketStatus" ADD VALUE 'OCR_FAILED';
ALTER TYPE "TicketStatus" ADD VALUE 'NEEDS_MANUAL_INPUT';
ALTER TABLE "Ticket"
 ADD COLUMN "analysisToken" TEXT,
 ADD COLUMN "analysisStartedAt" TIMESTAMP(3),
 ADD COLUMN "confirmedData" JSONB,
 ADD COLUMN "confirmedAt" TIMESTAMP(3),
 ADD COLUMN "billingUrl" TEXT,
 ADD COLUMN "qrPayload" TEXT;
ALTER TABLE "TicketExtractedData"
 ADD COLUMN "rawText" TEXT,
 ADD COLUMN "warnings" JSONB,
 ADD COLUMN "fieldConfidence" JSONB;
CREATE TABLE "TicketOcrAttempt" (
 "id" TEXT NOT NULL,
 "organizationId" TEXT NOT NULL,
 "ticketId" TEXT NOT NULL,
 "provider" TEXT,
 "outcome" TEXT NOT NULL DEFAULT 'ANALYZING',
 "rawText" TEXT,
 "rawPayload" JSONB,
 "detectedData" JSONB,
 "confidence" DOUBLE PRECISION,
 "warnings" JSONB,
 "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "finishedAt" TIMESTAMP(3),
 CONSTRAINT "TicketOcrAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TicketOcrAttempt_organizationId_ticketId_startedAt_idx" ON "TicketOcrAttempt"("organizationId", "ticketId", "startedAt");
ALTER TABLE "TicketOcrAttempt" ADD CONSTRAINT "TicketOcrAttempt_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "Ticket"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
