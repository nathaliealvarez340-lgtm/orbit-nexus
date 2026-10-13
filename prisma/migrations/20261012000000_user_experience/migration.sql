-- Additive: existing accounts/accent values remain intact. NULL means no override.
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK');
CREATE TYPE "ProfessionalRole" AS ENUM ('FOUNDER_CEO', 'FINANCE_ACCOUNTING', 'OPERATIONS', 'PRODUCT', 'ENGINEERING_TECH', 'MARKETING_SALES', 'CONSULTANT', 'DESIGNER', 'OTHER');
CREATE TYPE "CommunicationCategory" AS ENUM ('NEWS_UPDATES', 'PRODUCT_NEWS', 'COMMERCIAL_OFFERS');
CREATE TYPE "ConsentDecision" AS ENUM ('GRANTED', 'REVOKED');
CREATE TYPE "PreferenceChangeSource" AS ENUM ('REGISTRATION', 'SETTINGS');
ALTER TABLE "User" ADD COLUMN "givenName" TEXT, ADD COLUMN "familyName" TEXT;
ALTER TABLE "UserPreference"
  ADD COLUMN "theme" "ThemeMode",
  ADD COLUMN "locale" VARCHAR(35),
  ADD COLUMN "timezone" VARCHAR(64),
  ADD COLUMN "jobRole" "ProfessionalRole",
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "onboardingPreferencesCompletedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE TABLE "CommunicationPreference" (
  "userId" TEXT NOT NULL,
  "category" "CommunicationCategory" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationPreference_pkey" PRIMARY KEY ("userId", "category"),
  CONSTRAINT "CommunicationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "CommunicationConsentRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" "CommunicationCategory" NOT NULL,
  "decision" "ConsentDecision" NOT NULL,
  "version" TEXT NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "textLocale" VARCHAR(35) NOT NULL,
  "source" "PreferenceChangeSource" NOT NULL,
  "jurisdiction" VARCHAR(64),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CommunicationConsentRecord_userId_type_recordedAt_idx" ON "CommunicationConsentRecord"("userId", "type", "recordedAt");
CREATE FUNCTION "protect_communication_consent_record"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Communication consent evidence is append-only'; END;
$$;
CREATE TRIGGER "communication_consent_append_only" BEFORE UPDATE OR DELETE ON "CommunicationConsentRecord"
FOR EACH ROW EXECUTE FUNCTION "protect_communication_consent_record"();
