import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { runFleetTick } from "@/lib/fleet/tick";

// Scheduled fleet monitoring. Called every minute by pg_cron + pg_net
// from Supabase, which is where the schedule lives — Postgres does
// minute-level cron on the free plan, so this needs no Vercel cron and
// no plan change.
//
// This route is a public URL, so the shared secret is the only thing
// standing between the internet and an unauthenticated trigger of the
// whole poll. Middleware does not protect it: its matcher would redirect
// an unauthenticated caller to /login, so the check has to be here.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Primary auth: a single-use token Postgres minted for this call and
// stored in tick_nonces. Redeeming it is a delete, so it can't be
// replayed, and minting one requires database write access — which
// makes this strictly harder to forge than a static secret, and needs
// nothing configured by hand in two places.
async function redeemedNonce(request: NextRequest): Promise<boolean> {
  const nonce = request.headers.get("x-tick-nonce");
  if (!nonce) return false;

  const { data, error } = await createServiceClient()
    .from("tick_nonces")
    .delete()
    .eq("nonce", nonce)
    .gt("created_at", new Date(Date.now() - 3 * 60_000).toISOString())
    .select("nonce");

  if (error) {
    console.error("[tick] rejected: could not redeem nonce:", error.message);
    return false;
  }
  if (!data || data.length === 0) {
    console.error("[tick] rejected: nonce unknown, expired, or already used");
    return false;
  }
  return true;
}

// Fallback auth, kept for manual curl testing and for anyone who does
// set CRON_SECRET. Absent env var is no longer an error — the nonce is
// the normal path — so this only reports a genuine mismatch.
function matchesSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer /, "") ??
    "";

  if (!provided) return false;

  // Compare as fixed-length buffers so the check can't be timed, and so
  // a length mismatch doesn't throw instead of returning false.
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    console.error(
      `[tick] rejected: secret length mismatch — header ${a.length} chars, CRON_SECRET ${b.length}. ` +
        "Usually a stray quote, space or newline around the value."
    );
    return false;
  }

  const ok = timingSafeEqual(a, b);
  if (!ok) console.error("[tick] rejected: secret is the right length but does not match");
  return ok;
}

async function handle(request: NextRequest) {
  if (!(await redeemedNonce(request)) && !matchesSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFleetTick(createServiceClient());
    if (result.warnings.length > 0) {
      console.warn("[tick] completed with warnings:", result.warnings);
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    console.error("[tick] failed:", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

// GET as well, so the schedule can be smoke-tested with curl.
export async function GET(request: NextRequest) {
  return handle(request);
}
