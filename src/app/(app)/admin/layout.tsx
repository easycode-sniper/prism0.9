import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/supabase/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();

  if (!admin) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
