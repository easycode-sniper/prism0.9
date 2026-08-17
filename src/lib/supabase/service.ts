import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Only ever constructed on
// the server: in admin actions, and in the scheduled tick, which runs
// with no user session at all and so has no other way to write.
//
// Not a "use server" module on purpose. This returns a Supabase client,
// which can't be serialised across a server-action boundary, and must
// never be reachable from the browser.

let cached: ReturnType<typeof createClient> | null = null;

export function createServiceClient() {
  if (!cached) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
    cached = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cached;
}
