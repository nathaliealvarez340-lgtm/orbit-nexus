import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#08080a] px-5 py-12 text-white"><div className="orb-grid absolute inset-0 opacity-40" /><div className="absolute left-6 top-6"><Logo /></div><div className="relative w-full max-w-md">{children}<p className="mt-6 text-center text-xs text-zinc-600">Al continuar aceptas los <Link href="#" className="text-zinc-400">términos</Link> y el aviso de privacidad.</p></div></main>;
}
