import { Landing } from "@/components/marketing/landing";
import { publicMetadata } from "@/lib/web-metadata";
export const metadata = publicMetadata("Operación financiera y fiscal", "/");

export default function Home() {
  return <Landing />;
}
