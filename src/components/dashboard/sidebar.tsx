import { Logo } from "@/components/brand/logo";
import { Navigation } from "./navigation";
import { LogoutButton } from "./logout-button";
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/[.07] bg-[#09090b]/95 p-4 lg:flex">
      <div className="px-2 py-3">
        <Logo />
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <Navigation />
      </div>
      <div className="mt-4 border-t border-white/10 pt-3">
        <LogoutButton />
      </div>
    </aside>
  );
}
