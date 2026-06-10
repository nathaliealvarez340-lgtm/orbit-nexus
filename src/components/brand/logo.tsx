import Image from "next/image";
import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5 font-semibold tracking-[-0.03em]">
      <Image
        src="/logo/logo-orbit.png"
        alt={compact ? "ORBIT NEXUS" : ""}
        width={32}
        height={32}
        className="size-8 object-contain"
        priority
      />
      {!compact && <span>ORBIT <span className="text-zinc-500">NEXUS</span></span>}
    </Link>
  );
}
