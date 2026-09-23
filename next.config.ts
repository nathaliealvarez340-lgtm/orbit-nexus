import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return ["/api/:path*", "/dashboard/:path*"].map((source) => ({
      source,
      headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }));
  },
};

export default nextConfig;
