// Try again when the failure was the gateway, not the query.
//
// WHY THIS EXISTS. Measured 2026-09-14: the fleet tick was completing
// about half its runs. Every lost run traced to the same thing — a
// trivial request to the Data API coming back "Gateway Timeout", "Bad
// Gateway" or "Failed to get project config" after a flat ~5 seconds,
// while Postgres itself sat idle and answered every real query in
// milliseconds. The database was never busy; the API layer in front of
// it was dropping requests.
//
// Those failures are transient by nature, and the tick had no retry
// anywhere: a single blip on one DELETE rejected the whole minute's run
// with a 401, and a single blip on one SELECT made the tick report
// "Wialon is not configured" and return 502. Both are a whole minute of
// fleet tracking thrown away over an error that would very likely have
// succeeded 200ms later.
//
// WHAT IS NOT RETRIED, and this is the important half. A real
// PostgREST or Postgres error — permission denied, unique violation,
// function not found, a malformed filter — is DETERMINISTIC. Asking
// again gets the same answer, a little later, having spent budget that
// the tick does not have to spare. Those carry an error `code`, and
// their presence is exactly how this tells the two apart.
//
// A PLAIN MODULE with `sleep` injectable, so the whole thing can be
// asserted offline without waiting in real time — see
// scripts/check-retry.mts. Same shape as freshness.ts and cache.ts.

/** What a Supabase call hands back. Only `error` matters here. */
interface Failable {
  error: unknown;
}

/** Infrastructure failures worth a second attempt. Deliberately narrow
 *  and matched on the message, because these arrive with no error code:
 *  the gateway answers with a non-JSON body, so supabase-js has nothing
 *  structured to report and passes the status text through. */
const TRANSIENT = /gateway|timeout|timed out|fetch failed|network|socket|econn|ehostunreach|etimedout|503|502|504|520|521|522|523|524|525|upstream|failed to get project config|service unavailable|too many connections|connection closed|terminating connection/i;

/**
 * Is this worth trying again?
 *
 * An error carrying a `code` came from PostgREST or Postgres, which means
 * it is an answer rather than a failure to deliver one — never retried,
 * whatever its message says. Everything else is judged on the message.
 */
export function isTransient(error: unknown): boolean {
  if (!error) return false;

  // A thrown network error (undici's "fetch failed", a reset socket)
  // reaches us as an Error with no code. Judge it on the message.
  const record = error as { code?: unknown; message?: unknown };

  // PostgREST codes are strings ("PGRST202", "42501", "23505"). A real
  // code means a real, repeatable answer.
  if (typeof record.code === "string" && record.code !== "") return false;

  const message = typeof record.message === "string" ? record.message : String(error);
  return TRANSIENT.test(message);
}

export interface RetryOptions {
  /** TOTAL attempts, not extra ones. Defaults to 2 — one retry.
   *
   *  Two, not five, and the reason is the clock: a request that is going
   *  to fail this way takes about five seconds to do it, and the tick
   *  has a 55-second budget before pg_net gives up on it. Three attempts
   *  at three call sites is fifteen seconds of a minute spent waiting to
   *  be told no. One retry catches the overwhelming majority of blips —
   *  they are isolated, not sustained — at a bounded cost. */
  attempts?: number;
  /** Base pause before retrying, doubled each further attempt. */
  delayMs?: number;
  /** Named in the log line, so a retry is visible in the tick's output
   *  rather than being a silent slowdown. */
  label?: string;
  /** Injected so tests need not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a Supabase call, retrying only a transient failure.
 *
 * Takes the whole `{ data, error }` result rather than throwing, because
 * that is the shape supabase-js returns; a call that THROWS (a socket
 * dying mid-flight) is caught, judged the same way, and rethrown if it
 * is not transient or the attempts run out.
 *
 * IDEMPOTENCE IS THE CALLER'S PROBLEM, and worth thinking about at each
 * site. Retrying is safe when the worst case is doing the same read
 * twice. For a write, consider what happens if the first attempt
 * actually landed and only its RESPONSE was lost — see the note at the
 * nonce redemption, where that case is deliberately no worse than the
 * behaviour this replaced.
 */
export async function withRetry<T extends Failable>(
  run: () => PromiseLike<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const delayMs = options.delayMs ?? 200;
  const sleep = options.sleep ?? realSleep;
  const label = options.label ?? "supabase";

  let lastThrown: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let result: T | undefined;
    lastThrown = undefined;

    try {
      result = await run();
    } catch (thrown) {
      lastThrown = thrown;
      if (!isTransient(thrown) || attempt === attempts) throw thrown;
    }

    if (result) {
      if (!result.error) return result;
      if (!isTransient(result.error) || attempt === attempts) return result;
    }

    const failure = lastThrown ?? result?.error;
    const message = (failure as { message?: string })?.message ?? String(failure);
    console.warn(`[retry] ${label}: ${message} — attempt ${attempt} of ${attempts}, retrying`);
    // Doubling, so a second retry (if a caller asks for one) does not
    // land in the same bad moment as the first.
    await sleep(delayMs * 2 ** (attempt - 1));
  }

  // Unreachable: the loop returns or throws on its final attempt. Here
  // only to satisfy the type, and to fail loudly rather than quietly if
  // the logic above is ever changed.
  throw lastThrown ?? new Error(`[retry] ${label}: exhausted without a result`);
}
