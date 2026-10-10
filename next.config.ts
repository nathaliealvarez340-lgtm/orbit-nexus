import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Fase 5C.2 §9: CSP, clickjacking, MIME, referrer, permissions and private caching.
  async headers() {
    return securityHeaders();
  },
};

export default nextConfig;
