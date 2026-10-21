-- Fase 5C.8 crash-safe PAC recovery (docs/tasks/FASE5C8-PAC-SANDBOX.md §21.3). Additive only:
-- no DROP, no rename, no column change. Neither CHECKs nor triggers are representable in the
-- Prisma schema; they live only in this migration.
--
-- The stamping service commits the authorization, the attempt (stable CustomID, invoice
-- version) and the exact XsdValidatedCfdi40 bytes with their hashes BEFORE the PAC call. A new
-- process recovers them from here to reconcile with the same bytes and the same CustomID. These
-- rules make that recovery evidence tamper-evident in the database itself, not only in the code.

-- The persisted request is pinned by its hash: bytes and hashes exist together, and
-- requestSha256 is exactly the SHA-256 of sealedXml. Same for the verified stamped CFDI.
ALTER TABLE "StampAttempt" ADD CONSTRAINT "StampAttempt_request_pinned_check" CHECK (
  ("sealedXml" IS NULL) = ("requestSha256" IS NULL)
  AND ("sealedXml" IS NULL) = ("preSealSha256" IS NULL)
  AND ("sealedXml" IS NULL) = ("originalStringSha256" IS NULL)
  AND ("sealedXml" IS NULL OR encode(sha256("sealedXml"), 'hex') = "requestSha256")
);
ALTER TABLE "StampAttempt" ADD CONSTRAINT "StampAttempt_stamped_pinned_check" CHECK (
  ("stampedXml" IS NULL) = ("stampedSha256" IS NULL)
  AND ("stampedXml" IS NULL OR encode(sha256("stampedXml"), 'hex') = "stampedSha256")
);

-- Immutability: the identity of the logical attempt never changes; once the request is
-- persisted (it may have reached the PAC) its bytes and hashes never change; once a stamp is
-- recorded it never changes; submissionCount only grows; an attempt that may have reached the
-- PAC is never deleted.
CREATE FUNCTION "stamp_attempt_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."requestSha256" IS NOT NULL OR OLD."submissionCount" > 0 THEN
      RAISE EXCEPTION 'STAMP_ATTEMPT_SUBMITTED_NOT_DELETABLE';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId"
    OR NEW."invoiceVersion" IS DISTINCT FROM OLD."invoiceVersion"
    OR NEW."authorizationId" IS DISTINCT FROM OLD."authorizationId"
    OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."adapter" IS DISTINCT FROM OLD."adapter"
    OR NEW."environment" IS DISTINCT FROM OLD."environment"
    OR NEW."customId" IS DISTINCT FROM OLD."customId"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'STAMP_ATTEMPT_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD."requestSha256" IS NOT NULL AND (
    NEW."requestSha256" IS DISTINCT FROM OLD."requestSha256"
    OR NEW."preSealSha256" IS DISTINCT FROM OLD."preSealSha256"
    OR NEW."originalStringSha256" IS DISTINCT FROM OLD."originalStringSha256"
    OR NEW."sealedXml" IS DISTINCT FROM OLD."sealedXml") THEN
    RAISE EXCEPTION 'STAMP_ATTEMPT_REQUEST_IMMUTABLE';
  END IF;
  IF OLD."uuid" IS NOT NULL AND (
    NEW."uuid" IS DISTINCT FROM OLD."uuid"
    OR NEW."stampedXml" IS DISTINCT FROM OLD."stampedXml"
    OR NEW."stampedSha256" IS DISTINCT FROM OLD."stampedSha256"
    OR NEW."stampedAt" IS DISTINCT FROM OLD."stampedAt"
    OR NEW."rfcProvCertif" IS DISTINCT FROM OLD."rfcProvCertif"
    OR NEW."noCertificadoSat" IS DISTINCT FROM OLD."noCertificadoSat") THEN
    RAISE EXCEPTION 'STAMP_ATTEMPT_STAMP_IMMUTABLE';
  END IF;
  IF NEW."submissionCount" < OLD."submissionCount" THEN
    RAISE EXCEPTION 'STAMP_ATTEMPT_SUBMISSIONS_ONLY_GROW';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "StampAttempt_immutable"
  BEFORE UPDATE OR DELETE ON "StampAttempt"
  FOR EACH ROW EXECUTE FUNCTION "stamp_attempt_immutable"();

-- An authorization is a record of what a user accepted for one invoice version: never edited.
CREATE FUNCTION "stamp_authorization_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'STAMP_AUTHORIZATION_IMMUTABLE';
END;
$$;

CREATE TRIGGER "StampAuthorization_immutable"
  BEFORE UPDATE ON "StampAuthorization"
  FOR EACH ROW EXECUTE FUNCTION "stamp_authorization_immutable"();
