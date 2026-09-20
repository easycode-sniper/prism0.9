import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { withRetry } from "@/lib/supabase/retry";
import { runDeepTick } from "@/lib/fleet/tick";

// The DEEP half of fleet monitoring, every three minutes: per-dispatch
// route deviation and ETA, the client-site zone log, speeding. These are
// the CPU-heavy checks (the route projection is haversine per segment
// per active dispatch) and the latency-tolerant ones — zone-visit
// durations quantize to this cadence, which was the accepted trade for
// the CPU saving. The one-minute live cycle and its reasoning live at
// /api/tick; see src/lib/fleet/tick.ts for the split's ownership rules.
//
// Same nonce scheme as the live route, SHARING tick_nonces: each
// dispatch mints its own single-use token, so two schedules drawing
// from one table cannot collide or consume each other's calls.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function redeemedNonce(request: NextRequest): Promise<boolean> {
  const nonce = request.headers.get("x-tick-nonce");
  if (!nonce) return false;

  // Retried on a transient failure only — the exact contract the live
  // route established (see its long note): a delivery failure is worth
  // one more attempt, a successful call returning zero rows is an
  // answer, and the replay protection is untouched either way.
  const { data, error } = await withRetry(
    () =>
      createServiceClient()
        .from("tick_nonces")
        .delete()
        .eq("nonce", nonce)
        .gt("created_at", new Date(Date.now() - 3 * 60_000).toISOString())
        .select("nonce"),
    { label: "deep nonce redemption" }
  );

  if (error) {
    console.error("[tick-deep] rejected: could not redeem nonce:", error.message);
    return false;
  }
  if (!data || data.length === 0) {
    console.error("[tick-deep] rejected: nonce unknown, expired, or already used");
    return false;
  }
  return true;
}

// Fallback auth for manual curl testing, same shape as the live route.
function matchesSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer /, "") ??
    "";
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  if (!(await redeemedNonce(request)) && !matchesSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDeepTick(createServiceClient());
    if (result.warnings.length > 0) {
      console.warn("[tick-deep] completed with warnings:", result.warnings);
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    console.error("[tick-deep] failed:", err);
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
