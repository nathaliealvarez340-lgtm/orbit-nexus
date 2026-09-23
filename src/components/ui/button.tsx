import Link from "next/link";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Button({
  href,
  children,
  variant = "primary",
  className,
  type = "button",
  ...props
}: {
  href?: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  type?: "button" | "submit";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type">) {
  const styles = cn(
    "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-[transform,background-color,border-color,color] duration-150 active:scale-[.97]",
    variant === "primary" && "bg-white text-zinc-950 hover:bg-zinc-200",
    variant === "secondary" && "border border-white/10 bg-white/[.04] text-white hover:bg-white/[.08]",
    variant === "ghost" && "text-zinc-400 hover:bg-white/[.05] hover:text-white",
    className,
  );
  return href ? <Link href={href} className={styles}>{children}</Link> : <button type={type} className={styles} {...props}>{children}</button>;
}
