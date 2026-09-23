import { cookies } from "next/headers";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { FloatingCapture } from "@/components/dashboard/floating-capture";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import { requirePageTenant } from "@/lib/tenant";
import { parseConsent } from "@/lib/consent";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await requirePageTenant();
  const consent = parseConsent((await cookies()).get("orbit.consent")?.value);
  return (
    <div className="min-h-screen bg-[#0c0c0f] text-white">
      <Sidebar />
      <div className="lg:pl-64">
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
    </div>
  );
}
