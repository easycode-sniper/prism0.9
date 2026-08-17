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

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer /, "") ??
    "";

  // Compare as fixed-length digests so the check can't be timed, and so
  // a length mismatch doesn't throw instead of returning false.
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
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
