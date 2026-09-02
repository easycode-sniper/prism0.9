"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadWialonConfig, probeWialonZones, type WialonResourceShape } from "@/lib/fleet/wialon";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";

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
  /** Whether the account is currently banned in auth.users.
   *
   *  This did not exist, and its absence made adminDisableUser a button
   *  with no visible effect: the ban was written, the list re-read
   *  `profiles` — which has no ban column — and the row came back
   *  looking exactly the same. adminEnableUser was consequently
   *  unreachable from the UI. */
  disabled: boolean;
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

  // Typed once here: the service-role client is generic, so the rows
  // come back untyped and every .map() below would be implicitly any.
  type ProfileRow = Omit<AdminUser, "disabled">;
  const profiles = (data ?? []) as ProfileRow[];

  // The ban state lives in auth.users, which is not reachable through
  // PostgREST — it needs the admin auth API, and that API pages. Walked
  // to exhaustion rather than trusting one call: a short page is the
  // only reliable end marker, and silently listing the first 50 users of
  // a larger org is the same class of bug as the PostgREST 1000-row cap.
  const banned = new Set<string>();
  try {
    for (let page = 1; page <= 20; page++) {
      const { data: authPage, error: authError } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (authError) throw new Error(authError.message);
      for (const u of authPage.users) {
        const until = (u as { banned_until?: string | null }).banned_until;
        if (until && new Date(until).getTime() > Date.now()) banned.add(u.id);
      }
      if (authPage.users.length < 200) break;
    }
  } catch (err) {
    // The roster is still worth showing without the ban column; saying
    // nothing and rendering every account as enabled would be worse.
    return {
      data: profiles.map((r) => ({ ...r, disabled: false })),
      error: `Roles loaded, but account status could not be read: ${(err as Error).message}`,
    };
  }

  return {
    data: profiles.map((r) => ({ ...r, disabled: banned.has(r.id) })),
    error: null,
  };
}

/**
 * Create an account with a password the ADMIN chooses.
 *
 * It was called adminInviteUser and it invited nobody. It called
 * createUser (not inviteUserByEmail) with `email_confirm: true` and
 * this as the password:
 *
 *     password: Math.random().toString(36).slice(2, 14)
 *
 * No mail is sent by that call, and the random string was never
 * returned, logged or shown. So every account it made was born
 * confirmed, enabled, correctly rolled — and impossible to sign into,
 * by anyone, ever. The button reported success because creation had in
 * fact succeeded; only logging in was impossible.
 *
 * The owner asked for the admin to set the password, which is the right
 * shape for this app: a small dispatch office with no self-service
 * signup and no reset mail configured. The admin types the password and
 * tells the person.
 */
export async function adminCreateUser(
  email: string,
  fullName: string,
  role: "operator" | "admin",
  password: string
): Promise<{ error: string | null }> {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };

  // Re-checked here and not only in the form. minLength on an input is
  // a courtesy to a cooperating browser; this is a POST endpoint any
  // signed-in admin can call directly with anything.
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    user_metadata: { full_name: fullName.trim() },
    // Still confirmed on creation: there is no mailbox round trip in
    // this flow to confirm through, and leaving it false would produce
    // exactly the unusable account this function was written to stop
    // producing.
    email_confirm: true,
  });

  if (error) return { error: error.message };

  if (data.user && role === "admin") {
    // The trigger on auth.users creates every profile as an operator,
    // so admin is a second write — and its failure used to be
    // discarded. That silently handed back an OPERATOR while the form
    // said the account was created, which is the worse direction for a
    // permissions mistake to fail in. Say it instead: the account
    // exists, and the role can be fixed from the table below.
    const { error: roleError } = await admin
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", data.user.id);

    if (roleError) {
      return {
        error: `Account created, but the admin role could not be set (${roleError.message}). It is an operator — change the role in the table below.`,
      };
    }
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

// ── Wialon zone probe ────────────────────────────────────────
//
// Admin-only, read-only, and it writes nothing. It answers one
// question before any geofence import gets built: do the Wialon zones
// already arrive in the resource search the Drivers page runs, and what
// shape are they? See probeWialonZones for why this is a probe rather
// than an importer.
//
// The credential is resolved with the SERVICE role, like every other
// Wialon path — app_config's SELECT policy is an allow-list that does
// not include 'wialon', so a session-scoped read would find nothing.
export async function adminProbeWialonZones(): Promise<{
  resources: WialonResourceShape[];
  error: string | null;
}> {
  const check = await requireAdmin();
  if (check.error) return { resources: [], error: check.error };

  const config = await loadWialonConfig(createServiceClient());
  if (!config) return { resources: [], error: "Wialon is not configured" };

  return probeWialonZones(config);
}
