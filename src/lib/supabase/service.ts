import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Only ever constructed on
// the server: in admin actions, and in the scheduled tick, which runs
// with no user session at all and so has no other way to write.
//
// Not a "use server" module on purpose. This returns a Supabase client,
// which can't be serialised across a server-action boundary, and must
// never be reachable from the browser.

// Annotated as the plain SupabaseClient type rather than
// ReturnType<typeof createClient>: that utility type does not fully
// resolve postgrest-js's nested conditional generic defaults, so a
// direct `.rpc(name, args)` call on it type-errors, claiming args must
// be `undefined`, no matter what is passed. Every other caller in this
// codebase already accepts a client typed this same plain way.
let cached: SupabaseClient | null = null;

export function createServiceClient(): SupabaseClient {
  if (!cached) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
    cached = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cached;
}
