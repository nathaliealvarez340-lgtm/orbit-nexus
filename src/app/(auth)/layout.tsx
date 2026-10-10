import { Logo } from "@/components/brand/logo";
import { LegalLinks } from "@/components/privacy/legal-links";
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page relative grid min-h-screen place-items-center bg-[#08080a] px-5 py-24 text-white">
      <div className="orb-grid absolute inset-0 opacity-40" />
      <div className="absolute left-6 top-6">
        <Logo />
      </div>
      <div className="relative w-full max-w-md">
        {children}
        <footer className="mt-6">
          <LegalLinks />
        </footer>
      </div>
    </main>
  );
}
