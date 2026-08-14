"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

let adminClient: any = null;

function getAdminClient(): any {
  if (!adminClient) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
    adminClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      key,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return adminClient;
}

async function requireAdmin(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.data.user.id)
    .single();

  if (profile?.role !== "admin") return { error: "Admin access required" };
  return {};
}

// ── User Management ──

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  role: "operator" | "admin";
  created_at: string;
}

export async function adminListUsers(): Promise<{ data: AdminUser[]; error: string | null }> {
  const check = await requireAdmin();
  if (check.error) return { data: [], error: check.error };

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .order("created_at", { ascending: false });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as AdminUser[], error: null };
}

export async function adminInviteUser(email: string, fullName: string, role: "operator" | "admin"): Promise<{ error: string | null }> {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };

  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: Math.random().toString(36).slice(2, 14),
    user_metadata: { full_name: fullName },
    email_confirm: true,
  });

  if (error) return { error: error.message };
  if (data.user && role === "admin") {
    await admin.from("profiles").update({ role: "admin" }).eq("id", data.user.id);
  }
  return { error: null };
}

export async function adminSetUserRole(userId: string, role: "operator" | "admin"): Promise<{ error: string | null }> {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };

  const admin = getAdminClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  return { error: error?.message ?? null };
}

export async function adminDisableUser(userId: string): Promise<{ error: string | null }> {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };

  const admin = getAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "2400h" });
  return { error: error?.message ?? null };
}

export async function adminEnableUser(userId: string): Promise<{ error: string | null }> {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };

  const admin = getAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
  return { error: error?.message ?? null };
}

// ── App Settings ──

export interface AppSettings {
  wialon_relay: string;
  wialon_server: string;
  wialon_token_set: boolean;
}

export async function adminGetSettings(): Promise<{ data: AppSettings | null; error: string | null }> {
  const check = await requireAdmin();
  if (check.error) return { data: null, error: check.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_config")
    .select("config_value")
    .eq("config_key", "wialon")
    .single();

  if (error || !data) return { data: null, error: error?.message ?? "Not found" };
  const config = data.config_value as { relay: string; server: string; token: string };

  return {
    data: {
      wialon_relay: config.relay || "https://wialon-relay1.ferdjellahsouhaibomd.workers.dev",
      wialon_server: config.server || "hst-api.wialon.eu",
      wialon_token_set: !!config.token,
    },
    error: null,
  };
}

export async function adminSaveSettings(relay: string, server: string, token: string): Promise<{ error: string | null }> {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };

  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  const admin = getAdminClient();

  const { error } = await admin
    .from("app_config")
    .update({
      config_value: { relay, server, token },
      updated_by: user.data.user?.id,
      updated_at: new Date().toISOString(),
    })
    .eq("config_key", "wialon");

  return { error: error?.message ?? null };
}
