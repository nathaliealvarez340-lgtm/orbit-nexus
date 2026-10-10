import type { MetadataRoute } from "next";
import { publicPaths, siteOrigin } from "@/lib/web-metadata";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return origin
    ? publicPaths.map((path) => ({ url: new URL(path, origin).href }))
    : [];
}
