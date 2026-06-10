import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#0c0c0f] text-white"><Sidebar /><div className="lg:pl-64"><Topbar /><main className="mx-auto max-w-[1500px] p-5 md:p-8">{children}</main></div></div>;
}
