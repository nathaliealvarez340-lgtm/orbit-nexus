import { redirect } from "next/navigation";
import { requirePageTenant } from "@/lib/tenant";
export default async function Page() {
  await requirePageTenant();
  redirect("/dashboard/invoices/new");
}
