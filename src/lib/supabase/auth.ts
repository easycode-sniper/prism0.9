import { createClient } from "@/lib/supabase/server";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: "operator" | "admin";
  created_at: string;
  updated_at: string;
}

export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error || !user ? null : user;
}

export async function getCurrentProfile(): Promise<UserProfile | null> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();
  return data;
}

export async function isAdmin(): Promise<boolean> {
  return (await getCurrentProfile())?.role === "admin";
}
