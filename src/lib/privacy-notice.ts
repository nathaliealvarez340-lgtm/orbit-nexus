// Fase 5C D12: the Privacy Notice version is supplied by the operator; ORBIT never
// invents it. It may be null only while fiscal production stays blocked.
type Env = Record<string, string | undefined>;

export function privacyNoticeVersion(env: Env = process.env) {
  return env.PRIVACY_NOTICE_VERSION?.trim() || null;
}

/** Fiscal production: a production deployment or a production PAC environment (D14). */
export function fiscalProductionRequested(env: Env = process.env) {
  return (
    env.VERCEL_ENV === "production" || env.PAC_ENVIRONMENT === "PRODUCTION"
  );
}

/** True when fiscal document processing must stop because no Privacy Notice exists. */
export function privacyNoticeBlocksProcessing(env: Env = process.env) {
  return fiscalProductionRequested(env) && !privacyNoticeVersion(env);
}
