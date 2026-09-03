// Prism — end-to-end check of the DEPLOYED site.
//
//   node --experimental-strip-types scripts/site-test.mts
//   node --experimental-strip-types scripts/site-test.mts --url http://localhost:3000
//   node --experimental-strip-types scripts/site-test.mts --routes /dashboard,/dispatch
//
// WHY THIS SCRIPT EXISTS: `npx tsc --noEmit && npm run lint && npm run
// build` is the gate this project already had, and all three pass on a
// page that renders nothing. They passed on the "use server" export that
// only blew up in the production render (see check-server-actions.mts).
// They pass on a chart whose animation loop throws, on a Leaflet layer
// whose popup HTML was never written, and on a server component that
// only fails once a real Supabase session is attached to the request.
//
// None of those is visible before deploy. So this script does the one
// thing the build cannot: it signs in to the real site as a real user
// and looks at what the browser actually painted.
//
// It is deliberately a SMOKE test, not a suite. It answers "is the
// deployed site standing up, on every route, for a logged-in user" —
// and nothing finer. A failure here means something is broken for
// everyone; it does not mean the business logic is right.
//
// Exit codes are the contract, because the site-tester agent reads them:
//
//   0  every route passed
//   1  the run completed and found failures  (a real regression)
//   2  the run could not happen at all       (NOT a pass — see below)
//
// The distinction between 1 and 2 is the whole point. A sandbox with no
// egress, a missing password and a cold deployment all produce "no
// findings", and reporting that as green is worse than reporting
// nothing. Exit 2 says: this told you nothing, go and fix the harness.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------- config

const DEFAULT_URL = "https://prism0-9.vercel.app";

// Every route in the topbar (src/components/layout/TopbarNav.tsx) plus
// the admin section. `needs` is what this page must have PAINTED, over
// and above rendering at all — the two things the build cannot see.
const ROUTES: { path: string; needs?: { canvas?: number; leaflet?: boolean } }[] = [
  { path: "/dashboard", needs: { canvas: 1 } },
  { path: "/dispatch", needs: { leaflet: true } },
  { path: "/monitoring" },
  { path: "/history" },
  { path: "/reports" },
  { path: "/drivers" },
  { path: "/carburant" },
  { path: "/notifications" },
  { path: "/admin" },
  { path: "/admin/users" },
  { path: "/admin/sites", needs: { leaflet: true } },
  { path: "/admin/stations", needs: { leaflet: true } },
  { path: "/admin/settings" },
];

// Next.js paints these when a render throws. They are the single most
// valuable string to grep for: the HTTP status is still 200 underneath.
const ERROR_BOUNDARY_TEXT = [
  "Application error",
  "a client-side exception has occurred",
  "An error occurred in the Server Components render",
  "This page could not be found",
  "500",
];

// A page that rendered its shell but no content still has the topbar, so
// the floor has to sit above that. Measured: the emptiest real page
// (notifications, zero rows) carries ~400 characters.
const MIN_BODY_TEXT = 300;

// ------------------------------------------------------------------ args

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const baseUrl = (arg("url") ?? process.env.PRISM_TEST_URL ?? DEFAULT_URL).replace(/\/$/, "");
const outDir = arg("out") ?? join(process.cwd(), ".site-test");
const routeFilter = arg("routes")?.split(",").map((r) => r.trim()).filter(Boolean);
const routes = routeFilter ? ROUTES.filter((r) => routeFilter.includes(r.path)) : ROUTES;

// ------------------------------------------------------------ credentials

// Read .env.local rather than requiring an exported environment: it is
// gitignored, it is where every other secret in this project already
// lives, and it means the agent does not have to be handed a password.
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]) continue; // a real environment variable wins
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const email = process.env.PRISM_TEST_EMAIL;
const password = process.env.PRISM_TEST_PASSWORD;

// ----------------------------------------------------------------- report

type Finding = { route: string; check: string; detail: string };

const failures: Finding[] = [];
const passes: string[] = [];
const notes: string[] = [];

function fail(route: string, check: string, detail: string): void {
  failures.push({ route, check, detail });
  console.log(`  FAIL  ${check} — ${detail}`);
}

function pass(route: string, detail: string): void {
  passes.push(`${route}: ${detail}`);
  console.log(`  ok    ${detail}`);
}

/** Exit 2: the run could not happen. Never report this as a pass. */
function cannotRun(reason: string, remedy: string): never {
  console.error(`\nCANNOT RUN — ${reason}\n`);
  console.error(remedy);
  console.error("\nThis is not a passing result. Nothing was tested.\n");
  process.exit(2);
}

// -------------------------------------------------------------- preflight

if (!email || !password) {
  cannotRun(
    "no credentials",
    "Set PRISM_TEST_EMAIL and PRISM_TEST_PASSWORD in .env.local (gitignored)\n" +
      "or in the environment. See .env.local.example.",
  );
}

// Fetch before launching a browser: a blocked network fails here in a
// quarter of a second with a legible reason, instead of surfacing as a
// 30-second Playwright navigation timeout that reads like a slow site.
let preflightStatus: number;
try {
  const res = await fetch(`${baseUrl}/login`, { redirect: "manual" });
  preflightStatus = res.status;
} catch (err) {
  cannotRun(
    `${baseUrl} is not reachable from here (${(err as Error).message})`,
    "If this is a Claude Code sandbox, the environment's network policy is\n" +
      "blocking it — the site has to be on the allowlist, or run this script\n" +
      "from a machine that can reach it. Check:\n" +
      '  curl -sS "$HTTPS_PROXY/__agentproxy/status"',
  );
}

// 403 and 407 are ambiguous and the ambiguity matters: an agent sandbox
// whose network policy denies the host answers the CONNECT with exactly
// the same status the site would use for a real refusal. Naming only one
// of the two sends whoever reads this down the wrong path.
if (preflightStatus === 403 || preflightStatus === 407) {
  cannotRun(
    `${baseUrl}/login returned HTTP ${preflightStatus} — blocked, by one of two things`,
    "Either an egress proxy denied the host, or the deployment itself\n" +
      "refused. Tell them apart before drawing a conclusion:\n" +
      '  curl -sS "$HTTPS_PROXY/__agentproxy/status"\n' +
      "A recentRelayFailures entry naming this host means the sandbox blocked\n" +
      "it and the site is probably fine — reach it with the Vercel MCP tools\n" +
      "and report a degraded check. No entry means look at the deployment.",
  );
}

if (preflightStatus >= 400) {
  cannotRun(
    `${baseUrl}/login returned HTTP ${preflightStatus}`,
    "The deployment is not serving. Check the Vercel build for this commit\n" +
      "before treating this as an application bug.",
  );
}

// ----------------------------------------------------------------- browser

type Browser = { newContext(opts: unknown): Promise<Context>; close(): Promise<void> };
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Page = {
  goto(url: string, opts?: unknown): Promise<{ status(): number } | null>;
  url(): string;
  fill(sel: string, value: string): Promise<void>;
  click(sel: string): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  waitForFunction(fn: string, arg?: unknown, opts?: unknown): Promise<unknown>;
  evaluate<T>(fn: string): Promise<T>;
  screenshot(opts: unknown): Promise<void>;
  on(event: string, fn: (payload: never) => void): void;
  textContent(sel: string): Promise<string | null>;
};

let chromium: { launch(opts: unknown): Promise<Browser> };
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  cannotRun(
    "playwright-core is not installed",
    "  npm install\n\nIt is a devDependency of this project.",
  );
}

// The sandbox ships Chromium at a fixed path and blocks the download
// Playwright would otherwise attempt. On a laptop, let Playwright find
// its own browser instead of insisting on a path that will not exist.
const executablePath = process.env.PRISM_TEST_CHROMIUM ?? "/opt/pw-browsers/chromium";
let browser: Browser;
try {
  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
} catch {
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
  } catch (err) {
    cannotRun(
      `could not launch Chromium (${(err as Error).message})`,
      "Set PRISM_TEST_CHROMIUM to a Chromium binary, or install one with\n" +
        "  npx playwright install chromium",
    );
  }
}

// 1366x768 is the dispatch office's screen, per .claude/agents/layout-review.md.
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

// Per-navigation error buckets. Attached ONCE, cleared per route — a
// listener re-attached in a loop fires N times for one error.
let pageErrors: string[] = [];
let consoleErrors: string[] = [];
let failedRequests: string[] = [];

page.on("pageerror", (err: never) => {
  pageErrors.push(String((err as unknown as Error).message ?? err));
});
page.on("console", (msg: never) => {
  const m = msg as unknown as { type(): string; text(): string };
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("response", (res: never) => {
  const r = res as unknown as { status(): number; url(): string };
  // Only our own origin. CARTO tiles 4xx without an API key (see
  // .env.local.example) and that is a watermark, not a broken page.
  if (r.status() >= 400 && r.url().startsWith(baseUrl)) {
    failedRequests.push(`HTTP ${r.status()} ${r.url().replace(baseUrl, "")}`);
  }
});

mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------------- login

console.log(`\nPrism site test — ${baseUrl}\n`);
console.log("/login");

pageErrors = [];
consoleErrors = [];
failedRequests = [];

await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });

// Selectors come from src/app/(auth)/login/page.tsx. Ids, not classes:
// the classes are design-system names and get renamed; the ids are wired
// to <label for> and will not move silently.
await page.fill("#email", email);
await page.fill("#password", password);
await page.click("button.signin-submit");

// Either we land somewhere else, or the form shows .signin-error. Waiting
// for "not /login" alone would burn the full timeout on a bad password.
try {
  await page.waitForFunction(
    "!location.pathname.startsWith('/login') || !!document.querySelector('.signin-error')",
    undefined,
    { timeout: 45000 },
  );
} catch {
  await page.screenshot({ path: join(outDir, "login-timeout.png") });
  await browser.close();
  cannotRun(
    "sign-in neither completed nor reported an error within 45s",
    `Screenshot: ${join(outDir, "login-timeout.png")}\n` +
      "Supabase auth may be unreachable from the deployment.",
  );
}

const loginError = await page.textContent(".signin-error");
if (loginError) {
  await page.screenshot({ path: join(outDir, "login-rejected.png") });
  await browser.close();
  cannotRun(
    `sign-in was rejected: "${loginError.trim()}"`,
    // The form shows whatever signIn() came back with, and that is not
    // always about the password. A JSON parse error or a proxy refusal
    // surfaces here identically to "invalid login credentials", and
    // blaming the password for an unreachable auth server wastes the
    // next hour.
    'If that message reads like bad credentials ("Invalid login\n' +
      'credentials"), fix PRISM_TEST_EMAIL / PRISM_TEST_PASSWORD in .env.local.\n' +
      "Anything else — a JSON parse error, a host/allowlist refusal, a\n" +
      "timeout — means Supabase auth was unreachable from wherever this ran,\n" +
      "and the credentials were never actually tested.",
  );
}

await page.waitForTimeout(1500);
pass("/login", `signed in, landed on ${new URL(page.url()).pathname}`);
if (pageErrors.length) fail("/login", "pageerror", pageErrors.join(" | "));

// ------------------------------------------------------------------ routes

for (const route of routes) {
  console.log(`\n${route.path}`);

  pageErrors = [];
  consoleErrors = [];
  failedRequests = [];

  let status: number | null = null;
  try {
    const res = await page.goto(`${baseUrl}${route.path}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    status = res ? res.status() : null;
  } catch (err) {
    fail(route.path, "navigation", (err as Error).message);
    continue;
  }

  // Charts animate for 220ms (chartTheme.ts) and Leaflet lays out on a
  // rAF. Sampling earlier measures a half-drawn frame as an empty one.
  await page.waitForTimeout(2500);

  if (status !== null && status >= 400) {
    fail(route.path, "http status", `HTTP ${status}`);
  } else {
    pass(route.path, `HTTP ${status ?? 200}`);
  }

  // Bounced back to /login means the session did not survive, which
  // looks exactly like a working login until you check.
  const landed = new URL(page.url()).pathname;
  if (landed.startsWith("/login")) {
    fail(route.path, "auth", "redirected back to /login — session not held");
    continue;
  }

  const body = (await page.evaluate<string>("document.body.innerText")) ?? "";

  const boundary = ERROR_BOUNDARY_TEXT.find((t) => body.includes(t));
  if (boundary) {
    fail(route.path, "error boundary", `page rendered "${boundary}"`);
  }

  if (body.trim().length < MIN_BODY_TEXT) {
    fail(route.path, "empty render", `only ${body.trim().length} chars of text`);
  } else {
    pass(route.path, `${body.trim().length} chars rendered`);
  }

  if (pageErrors.length) {
    fail(route.path, "pageerror", `${pageErrors.length}: ${pageErrors.join(" | ").slice(0, 400)}`);
  }

  if (failedRequests.length) {
    fail(route.path, "failed request", failedRequests.slice(0, 5).join(" | "));
  }

  if (consoleErrors.length) {
    // Console noise is a note, not a failure — a third-party script or a
    // React hydration warning should not fail a deploy on its own.
    notes.push(`${route.path}: ${consoleErrors.length} console error(s) — ${consoleErrors[0].slice(0, 160)}`);
  }

  // --- did the canvas actually paint? -------------------------------
  if (route.needs?.canvas) {
    const lit = await page.evaluate<number>(`(() => {
      let total = 0;
      for (const c of document.querySelectorAll("canvas")) {
        if (!c.width || !c.height) continue;
        const ctx = c.getContext("2d");
        if (!ctx) continue;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] + d[i + 1] + d[i + 2] > 40 && d[i + 3] > 0) total++;
        }
      }
      return total;
    })()`);
    const canvasCount = await page.evaluate<number>("document.querySelectorAll('canvas').length");

    if (canvasCount < route.needs.canvas) {
      fail(route.path, "charts", `expected >=${route.needs.canvas} canvas, found ${canvasCount}`);
    } else if (lit < 1000) {
      // A chart that throws renders blank, and blank measures as a
      // perfectly tidy zero. This is the check that catches it.
      fail(route.path, "charts blank", `${canvasCount} canvas, only ${lit} lit pixels`);
    } else {
      pass(route.path, `${canvasCount} canvas, ${lit.toLocaleString()} lit pixels`);
    }
  }

  // --- did Leaflet build its layers? --------------------------------
  if (route.needs?.leaflet) {
    const map = await page.evaluate<{ panes: number; markers: number; tiles: number }>(`(() => ({
      panes: document.querySelectorAll(".leaflet-pane").length,
      markers: document.querySelectorAll(".leaflet-marker-icon").length,
      tiles: document.querySelectorAll(".leaflet-tile").length,
    }))()`);

    if (map.panes === 0) {
      fail(route.path, "map", "no .leaflet-pane — the map never mounted");
    } else {
      // Markers can legitimately be zero (an empty fleet, a site list
      // with no geofences), so this reports rather than judges. Tiles
      // are also allowed to be zero: they need a CARTO key.
      pass(route.path, `map mounted — ${map.panes} panes, ${map.markers} markers, ${map.tiles} tiles`);
    }
  }

  await page.screenshot({
    path: join(outDir, `${route.path.replace(/\//g, "_").replace(/^_/, "")}.png`),
    fullPage: false,
  });
}

await browser.close();

// ------------------------------------------------------------------ output

const report = {
  url: baseUrl,
  ranAt: new Date().toISOString(),
  commit: process.env.PRISM_TEST_COMMIT ?? null,
  routesTested: routes.length,
  passed: passes.length,
  failed: failures.length,
  failures,
  notes,
};

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));

console.log(`\n${"-".repeat(60)}`);
console.log(`${routes.length} routes · ${passes.length} checks passed · ${failures.length} failed`);

if (notes.length) {
  console.log("\nNotes (not failures):");
  for (const n of notes) console.log(`  · ${n}`);
}

if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f.route} — ${f.check}: ${f.detail}`);
  console.log(`\nScreenshots and report.json in ${outDir}`);
  process.exit(1);
}

console.log(`\nAll routes healthy. Screenshots in ${outDir}`);
process.exit(0);
