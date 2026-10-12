import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/web-metadata";
import { publishedPublicPaths } from "@/lib/legal-web";
import { currentLegalDocument, legalDocumentKinds } from "@/lib/legal/registry";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return origin
    ? publishedPublicPaths(legalDocumentKinds.map(currentLegalDocument)).map(
        (path) => ({ url: new URL(path, origin).href }),
      )
    : [];
}
