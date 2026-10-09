import { cookies } from "next/headers";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { FloatingCapture } from "@/components/dashboard/floating-capture";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import { requirePageTenant } from "@/lib/tenant";
import { parseConsent } from "@/lib/consent";
import { getDb } from "@/lib/db";
import type { CSSProperties } from "react";
import "./dashboard.css";
import "@/components/fiscal/fiscal.css";
import { PrivacyLayerProvider } from "@/components/privacy/privacy-layer";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await requirePageTenant();
  const preference = await getDb().userPreference.findUnique({
    where: { userId: tenant.userId },
  });
  const accents = {
    PURPLE: ["#8b5cf6", "#c4b5fd"],
    BLUE: ["#3b82f6", "#93c5fd"],
    ORANGE: ["#f97316", "#fdba74"],
    RED: ["#ef4444", "#fca5a5"],
  };
  const accent = accents[preference?.accent ?? "PURPLE"];
  const consent = parseConsent((await cookies()).get("orbit.consent")?.value);
  return (
    <div
      className="orbit-app min-h-screen bg-[#0c0c0f] text-white"
      style={
        {
          "--orbit-accent": accent[0],
          "--orbit-accent-soft": accent[1],
        } as CSSProperties
      }
    >
      <PrivacyLayerProvider>
        <Sidebar />
        <div className="orbit-workspace">
          <Topbar
            user={tenant.user}
            organizationId={tenant.organizationId}
            memberships={tenant.memberships}
          />
          <main className="mx-auto max-w-[1500px] p-5 pb-28 md:p-8 md:pb-28">
            {children}
          </main>
        </div>
        <FloatingCapture />
        <CookieConsent initial={consent} />
      </PrivacyLayerProvider>
    </div>
  );
}
