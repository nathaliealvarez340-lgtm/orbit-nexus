"use client";
import { PrivacyLayerProvider } from "./privacy-layer";
import { CookieConsent } from "./cookie-consent";
import { ProductAnalytics } from "./product-analytics";
export function WebPrivacy({ children }: { children: React.ReactNode }) {
  return (
    <PrivacyLayerProvider>
      {children}
      <CookieConsent />
      <ProductAnalytics />
    </PrivacyLayerProvider>
  );
}
