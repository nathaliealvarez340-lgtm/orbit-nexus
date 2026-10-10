import type { Metadata } from "next";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { FloatingCapture } from "@/components/dashboard/floating-capture";
import { requirePageTenant } from "@/lib/tenant";
import { getDb } from "@/lib/db";
import type { CSSProperties } from "react";
import "./dashboard.css";
import "@/components/fiscal/fiscal.css";
import { LegalLinks } from "@/components/privacy/legal-links";
import { privateRobots } from "@/lib/web-metadata";
export const metadata: Metadata = {
  title: "Espacio de trabajo",
  robots: privateRobots,
};
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
      <Sidebar />
      <div className="orbit-workspace">
        <Topbar
          user={tenant.user}
          organizationId={tenant.organizationId}
          memberships={tenant.memberships}
        />
        <main className="mx-auto max-w-[1500px] p-5 pb-28 md:p-8 md:pb-28">
          {children}
          <footer className="mt-12 border-t border-white/10 pt-5">
            <LegalLinks />
          </footer>
        </main>
      </div>
      <FloatingCapture />
    </div>
  );
}
