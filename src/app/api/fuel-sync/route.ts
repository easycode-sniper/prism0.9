import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchSheetRows } from "@/lib/fuel/googleSheets";
import { parseFuelRow, type FuelTransaction } from "@/lib/fuel/parse";

// Scheduled fuel-sheet sync. Called every 15 minutes by pg_cron + pg_net
// from Supabase — same mechanism as /api/tick, and the same reason: no
// Vercel cron, no plan change.
//
// This route is a public URL, so the nonce is the only thing standing
// between the internet and an unauthenticated trigger. Middleware does
// not protect it (its matcher would redirect an unauthenticated caller
// to /login), so the check has to be here — identical to /api/tick.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function redeemedNonce(request: NextRequest): Promise<boolean> {
  const nonce = request.headers.get("x-fuel-sync-nonce");
  if (!nonce) return false;

  const { data, error } = await createServiceClient()
    .from("fuel_sync_nonces")
    .delete()
    .eq("nonce", nonce)
    .gt("created_at", new Date(Date.now() - 3 * 60_000).toISOString())
    .select("nonce");

  if (error) {
    console.error("[fuel-sync] rejected: could not redeem nonce:", error.message);
    return false;
  }
  if (!data || data.length === 0) {
    console.error("[fuel-sync] rejected: nonce unknown, expired, or already used");
    return false;
  }
  return true;
}

// Fallback for manual curl testing, same shape as /api/tick.
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

const SPREADSHEET_ID = "1UI6xFOLcCouej53DtUYSg3X9NHw1-mgepKHw6AIIznY";
const RANGE = "gas consumption!A2:Q";

async function handle(request: NextRequest) {
  if (!(await redeemedNonce(request)) && !matchesSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rawRows = await fetchSheetRows(SPREADSHEET_ID, RANGE);

    const transactions: FuelTransaction[] = [];
    let skipped = 0;
    for (const row of rawRows) {
      const parsed = parseFuelRow(row);
      if (parsed) transactions.push(parsed);
      // A row with real cells that still fails to parse (no usable date)
      // is worth knowing about; the formula-filler tail rows (no
      // Transaction No at all) are the expected, silent case and are not
      // counted here — parseFuelRow returns null for both, so this only
      // approximates skip count. Good enough for a log line, not
      // depended on for correctness.
      else if (row.some((c) => c && c.trim())) skipped++;
    }

    const supabase = createServiceClient();
    const { data: refreshedCount, error } = await supabase.rpc(
      "refresh_fuel_transactions",
      { p_rows: transactions }
    );

    if (error) throw new Error(`refresh_fuel_transactions failed: ${error.message}`);

    console.log(`[fuel-sync] synced ${refreshedCount} transactions (${skipped} unparseable rows skipped)`);
    return NextResponse.json({ ok: true, synced: refreshedCount, skipped });
  } catch (err) {
    console.error("[fuel-sync] failed:", err);
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
