import { NextRequest, NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchSheetRows } from "@/lib/fuel/googleSheets";
import { dateCellOf, parseFuelRow, parseSheetDateTime, resolveOccurredAt, type FuelTransaction } from "@/lib/fuel/parse";

// Fuel-sheet sync. Two ways in:
//
// 1. pg_cron + pg_net every 15 minutes (x-fuel-sync-nonce) — the
//    backstop, same mechanism as /api/tick, and the same reason: no
//    Vercel cron, no plan change.
// 2. The Google Apps Script onChange trigger on the sheet itself
//    (x-fuel-sync-secret) — the primary path, which makes an edit land
//    in seconds. Google can only say "the sheet changed", so the
//    response is always the same idempotent full refresh.
//
// This route is a public URL, so the credential is the only thing
// standing between the internet and an unauthenticated trigger.
// Middleware does not protect it (its matcher would redirect an
// unauthenticated caller to /login), so the check has to be here —
// identical to /api/tick.

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

// The Apps Script push trigger's own credential. Separate from
// CRON_SECRET so the sheet script can be granted (and revoked) without
// touching the cron fallback, and so its scope on Vercel can be decided
// per environment — CRON_SECRET today only exists on Preview.
function matchesFuelPushSecret(request: NextRequest): boolean {
  const secret = process.env.FUEL_SYNC_SECRET;
  if (!secret) return false;

  const provided =
    request.headers.get("x-fuel-sync-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer /, "") ??
    "";
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Push coalescing ──────────────────────────────────────────────
//
// The Apps Script fires on every edit, and the owner sometimes pastes a
// batch of rows — several change events seconds apart, each of which
// would otherwise read the whole sheet and rewrite the whole table.
//
// So: the first call runs at once; calls inside the quiet window answer
// immediately ("deferred") and schedule ONE trailing run that fires
// after the window closes. The trailing run reads the sheet as it stands
// then, so coalescing N pushes into it loses nothing — its snapshot
// covers every row of the burst. Worst case across serverless instances
// is two refreshes running close together, which is harmless: the
// refresh is idempotent.
const MIN_RUN_INTERVAL_MS = 30_000;

let lastRunAt = 0;
let trailingScheduled = false;

const SPREADSHEET_ID = "1UI6xFOLcCouej53DtUYSg3X9NHw1-mgepKHw6AIIznY";
const RANGE = "gas consumption!A2:Q";

/**
 * FuelTransaction is camelCase, as TypeScript should be; the table and
 * refresh_fuel_transactions' jsonb_to_recordset column list are
 * snake_case, as Postgres should be. jsonb_to_recordset matches JSON
 * keys to those declared column names *by exact string*, so handing it
 * camelCase silently yields a row of NULLs for every column rather than
 * any kind of error — which then surfaces, confusingly, as a NOT NULL
 * violation on the primary key. This mapping is the seam between the two
 * conventions, and it is written out longhand so that adding a column to
 * one side without the other fails to compile.
 */
function toDbRow(t: FuelTransaction) {
  return {
    transaction_no: t.transactionNo,
    shift: t.shift,
    model: t.model,
    truck_id: t.truckId,
    category: t.category,
    driver_name: t.driverName,
    occurred_at: t.occurredAt,
    occurred_raw: t.occurredRaw,
    sheet_row: t.sheetRow,
    card_no: t.cardNo,
    station: t.station,
    fuel_type: t.fuelType,
    amount_da: t.amountDa,
    odometer_km: t.odometerKm,
    distance_km: t.distanceKm,
    litres_filled: t.litresFilled,
    expected_litres: t.expectedLitres,
    expected_cost_da: t.expectedCostDa,
    variance_da: t.varianceDa,
  };
}

async function runSync(): Promise<NextResponse> {
  // Phase timings, logged as we go rather than only at the end. A
  // serverless timeout kills the process without running any catch
  // block, so a function that only logs on success tells you nothing
  // about where it died — which is exactly the position the first
  // timeout left this in.
  const t0 = Date.now();
  const since = () => `${Date.now() - t0}ms`;

  try {
    console.log(`[fuel-sync] start`);
    const rawRows = await fetchSheetRows(SPREADSHEET_ID, RANGE);
    console.log(`[fuel-sync] sheet read: ${rawRows.length} rows at ${since()}`);

    // Dates are resolved across the whole column before any row is
    // parsed, because a single cell cannot say which format it is in.
    // The sheet changed format partway down — month-first above row 511,
    // day-first below — and the only thing that distinguishes them is
    // that the sheet is append-only, so its rows are in time order.
    const resolvedDates = resolveOccurredAt(rawRows.map(dateCellOf));
    // How many rows the order-based reading disagreed with the naive
    // day-first one on. Logged because it is the number that should fall
    // to zero once the sheet's own column is normalised — if it does
    // not, the two halves are still there.
    const ambiguousFixed = resolvedDates.filter((iso, i) => {
      if (!iso) return false;
      const naive = parseSheetDateTime(dateCellOf(rawRows[i]));
      return naive != null && naive !== iso;
    }).length;
    console.log(`[fuel-sync] dates resolved: ${ambiguousFixed} row(s) read against the sheet's order`);

    const transactions: FuelTransaction[] = [];
    let skipped = 0;
    // The index is the row's position in the sheet, and RANGE starts at
    // A2, so +2 makes it the row number a person would read off the
    // sheet itself. It is what the Carburant page orders by.
    for (const [i, row] of rawRows.entries()) {
      const parsed = parseFuelRow(row, i + 2, resolvedDates[i]);
      if (parsed) transactions.push(parsed);
      // A row with real cells that still fails to parse (no usable date)
      // is worth knowing about; the formula-filler tail rows (no
      // Transaction No at all) are the expected, silent case and are not
      // counted here — parseFuelRow returns null for both, so this only
      // approximates skip count. Good enough for a log line, not
      // depended on for correctness.
      else if (row.some((c) => c && c.trim())) skipped++;
    }
    console.log(`[fuel-sync] parsed: ${transactions.length} kept, ${skipped} skipped, at ${since()}`);

    // Transaction No is the primary key, and the sheet is maintained by
    // pasting batches of logs into it by hand — so an overlapping paste
    // duplicates rows, and the whole sync dies on a unique violation.
    // That is what stopped it: one duplicated transaction number froze
    // the table for a day and a half.
    //
    // Deduplicating here rather than in SQL is not a preference: the
    // insert reads its rows from jsonb_to_recordset, and ON CONFLICT
    // cannot absorb duplicates that arrive inside the same statement —
    // Postgres raises "cannot affect row a second time", the identical
    // failure the HQ arrival check hit. The payload has to be unique
    // before it is handed over.
    //
    // Last occurrence wins: if the same transaction is present twice, the
    // later row in the sheet is the more likely correction.
    const byId = new Map<string, FuelTransaction>();
    const duplicated = new Set<string>();
    for (const t of transactions) {
      if (byId.has(t.transactionNo)) duplicated.add(t.transactionNo);
      byId.set(t.transactionNo, t);
    }
    const unique = [...byId.values()];

    if (duplicated.size > 0) {
      // Named, not just counted — a duplicated transaction number can
      // mean a duplicated *fill*, which would double-count litres, so
      // whoever maintains the sheet needs to be able to find them.
      const sample = [...duplicated].slice(0, 5).join(", ");
      console.warn(
        `[fuel-sync] ${duplicated.size} duplicate transaction number(s) collapsed: ${sample}` +
          (duplicated.size > 5 ? ` (+${duplicated.size - 5} more)` : "")
      );
    }

    const supabase = createServiceClient();
    const { data: refreshedCount, error } = await supabase.rpc(
      "refresh_fuel_transactions",
      { p_rows: unique.map(toDbRow) }
    );
    console.log(`[fuel-sync] rpc returned at ${since()}`);

    if (error) throw new Error(`refresh_fuel_transactions failed: ${error.message}`);

    console.log(`[fuel-sync] synced ${refreshedCount} transactions (${skipped} unparseable rows skipped) in ${since()}`);

    // Touch the one-row signal so an open dashboard hears the change as
    // a single Realtime event rather than subscribing to this table
    // being rewritten row by row. Best-effort on purpose: the refresh
    // has already committed, and a failed touch must not report a
    // successful sync as failed — the 15-minute cron covers the gap.
    const { error: signalError } = await supabase
      .from("fuel_sync_signals")
      .upsert({
        id: 1,
        synced_at: new Date().toISOString(),
        synced_count: Number(refreshedCount ?? 0),
      });
    if (signalError) console.warn("[fuel-sync] signal touch failed:", signalError.message);

    return NextResponse.json({
      ok: true,
      synced: refreshedCount,
      skipped,
      duplicatesCollapsed: duplicated.size,
      duplicateSample: [...duplicated].slice(0, 5),
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(`[fuel-sync] failed at ${since()}:`, err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

async function handle(request: NextRequest) {
  if (!(await redeemedNonce(request)) && !matchesSecret(request) && !matchesFuelPushSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const sinceLast = now - lastRunAt;
  if (lastRunAt === 0 || sinceLast >= MIN_RUN_INTERVAL_MS) {
    lastRunAt = now;
    return runSync();
  }

  // Inside the quiet window: acknowledge at once and let one trailing
  // run — which reads the sheet as it stands when it fires — pick up
  // everything this burst changed.
  if (!trailingScheduled) {
    trailingScheduled = true;
    const waitMs = MIN_RUN_INTERVAL_MS - sinceLast;
    console.log(`[fuel-sync] deferred, trailing run in ${waitMs}ms`);
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      trailingScheduled = false;
      lastRunAt = Date.now();
      await runSync();
    });
  }
  return NextResponse.json({ ok: true, deferred: true });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

// GET as well, so the schedule can be smoke-tested with curl.
export async function GET(request: NextRequest) {
  return handle(request);
}
