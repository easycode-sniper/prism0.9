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

// Rejections log which case they are. A missing env var, a call with no
// header, and a genuinely wrong secret are three different problems with
// three different fixes, and they used to be indistinguishable from the
// outside: every one produced a bare 401 on a schedule nobody was
// watching. The response stays a plain 401 either way — the detail goes
// to the server log only, and only lengths are logged, never the value.
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[tick] rejected: CRON_SECRET is not set on this deployment");
    return false;
  }

  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer /, "") ??
    "";

  if (!provided) {
    console.error("[tick] rejected: request carried no x-cron-secret header");
    return false;
  }

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
