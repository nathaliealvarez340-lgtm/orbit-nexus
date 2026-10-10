// Fase 5C D12 / 5C.2 §5: the Privacy Notice version comes from the versioned legal
// source (src/lib/legal/registry.ts); ORBIT never invents it. It is null while the
// notice is a draft, and fiscal production stays blocked until it is published.
import type { LegalDocument } from "@/types/legal";
import { currentLegalDocument } from "./legal/registry";

type Env = Record<string, string | undefined>;

export function privacyNoticeVersion(
  notice: LegalDocument = currentLegalDocument("PRIVACY_NOTICE"),
) {
  return notice.status === "PUBLISHED" ? notice.version : null;
}

/** Fiscal production: a production deployment or a production PAC environment (D14). */
export function fiscalProductionRequested(env: Env = process.env) {
  return (
    env.VERCEL_ENV === "production" || env.PAC_ENVIRONMENT === "PRODUCTION"
  );
}

/** True when fiscal document processing must stop because no Privacy Notice exists. */
export function privacyNoticeBlocksProcessing(
  env: Env = process.env,
  notice: LegalDocument = currentLegalDocument("PRIVACY_NOTICE"),
) {
  return fiscalProductionRequested(env) && !privacyNoticeVersion(notice);
}
