import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Fase 5C.5: the approved XSLT engine runs from node_modules exactly as audited (its files are
  // hash-pinned by tests/cfdi40-engine-guard.test.ts) instead of being re-bundled. Its lazy
  // import of the optional XSLT 3 peer (never installed, never used by ORBIT) stays unresolved.
  serverExternalPackages: ["@tradik/xslt-processor"],
  // Fase 5C.2 §9: CSP, clickjacking, MIME, referrer, permissions and private caching.
  async headers() {
    return securityHeaders();
  },
};

export default nextConfig;
