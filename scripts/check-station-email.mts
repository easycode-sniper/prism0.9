// Checks for src/lib/notifications/email.ts.
//
// Run: node --experimental-strip-types scripts/check-station-email.mts
//
// WHY THIS SCRIPT EXISTS: the build cannot see any of this. tsc is happy
// with a timestamp formatted in the wrong timezone, with a config reader
// that treats a missing password as configured, and with a sender that
// throws where its whole contract is that it must not. Those are the
// three ways this feature fails in a way nobody notices until the fuel
// desk is reading an alert an hour off, or a tick dies at 06:00.
//
// No SMTP is dialled here — that would need a live mailbox and would
// test the mail server rather than this code. What is checked is
// everything up to the socket.

import {
  readConfig,
  stampAlgiers,
  subjectFor,
  bodyFor,
  sendStationStopEmails,
} from "../src/lib/notifications/email.ts";

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "ALERT_EMAIL_TO",
  "ALERT_EMAIL_FROM",
] as const;

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void): void {
  const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  // Skipping undefined rather than assigning it: process.env stringifies,
  // so `process.env.X = undefined` sets the literal "undefined" — which is
  // truthy, and would have made this helper prove the opposite of what the
  // case it is used for claims to test.
  for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const FULL = {
  SMTP_HOST: "smtp.office365.com",
  SMTP_USER: "alerts@omd-dz.com",
  SMTP_PASSWORD: "app-password",
  ALERT_EMAIL_TO: "service.carburant.omd@omd-dz.com",
};

console.log("\nconfig:");

withEnv({}, () => {
  const r = readConfig();
  check("nothing set is a reason, not a throw", "reason" in r);
  check(
    "the reason names every missing key",
    "reason" in r &&
      ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "ALERT_EMAIL_TO"].every((k) => r.reason.includes(k)),
    "reason" in r ? r.reason : "",
  );
});

withEnv({ ...FULL, SMTP_PASSWORD: undefined as unknown as string }, () => {
  const r = readConfig();
  check("a missing password alone is still 'not configured'", "reason" in r);
});

withEnv(FULL, () => {
  const r = readConfig();
  check("a complete env yields a config", "config" in r);
  check("port defaults to 587", "config" in r && r.config.port === 587);
  check("587 is STARTTLS, not implicit TLS", "config" in r && r.config.secure === false);
  check("from defaults to the authenticated mailbox", "config" in r && r.config.from === FULL.SMTP_USER);
  check("to is a list", "config" in r && r.config.to.length === 1);
});

withEnv({ ...FULL, SMTP_PORT: "465" }, () => {
  const r = readConfig();
  check("465 is implicit TLS", "config" in r && r.config.secure === true);
});

withEnv({ ...FULL, SMTP_PORT: "not-a-port" }, () => {
  const r = readConfig();
  check("a non-numeric port is refused, not coerced to NaN", "reason" in r);
});

withEnv({ ...FULL, ALERT_EMAIL_TO: "a@omd-dz.com, b@omd-dz.com ,, c@omd-dz.com" }, () => {
  const r = readConfig();
  check(
    "a comma list splits, trims and drops blanks",
    "config" in r && r.config.to.length === 3 && r.config.to[1] === "b@omd-dz.com",
    "config" in r ? JSON.stringify(r.config.to) : "",
  );
});

console.log("\ntimestamp:");

// 2026-09-07T07:56:00Z is 08:56 in Algiers (UTC+1, no DST). This is the
// exact case that made the check worth writing: the tick runs on a UTC
// clock, so an unpinned format would put 07:56 in the email and 08:56 in
// the app for the same stop.
const utc = new Date("2026-09-07T07:56:00Z");
const stamp = stampAlgiers(utc);
check("07:56 UTC renders as 08:56 Algiers", stamp.includes("08:56"), stamp);
check("date is day-first, matching the app", stamp.includes("07/09/2026"), stamp);

console.log("\nmessage:");

const alert = {
  truckId: "00032-523-35",
  driverName: null,
  stationName: "GD YOUB DAOUD",
};

const subject = subjectFor(alert);
check("subject carries the truck id", subject.includes("00032-523-35"), subject);
check("subject says what happened", subject.includes("blacklisted station"), subject);

const { text, html } = bodyFor(alert, utc);
check("body opens with the app's own sentence", text.includes("00032-523-35 has stopped at GD YOUB DAOUD."));
check("body names the station", text.includes("GD YOUB DAOUD"));
check("an unknown driver is stated, not blank", text.includes("unknown"));
check("body carries the Algiers time", text.includes("08:56"));
check("html carries the same truck", html.includes("00032-523-35"));

// The station name reaches the HTML from the database, so a name with a
// bracket in it must not be able to break out of the markup.
const nasty = bodyFor({ ...alert, stationName: 'A<script>alert("x")</script>B' }, utc);
check("station name is escaped in the html", !nasty.html.includes("<script>"), "raw <script> reached the html");
check("escaping is visible as entities", nasty.html.includes("&lt;script&gt;"));

console.log("\ncontract:");

// The one that matters most: this is called after the notification row
// is already written, so it must never throw. An unroutable host is the
// closest thing to a mail server being down that can be tested offline.
let threw: string | null = null;
let warnings: string[] = [];
try {
  const saved = { ...process.env };
  process.env.SMTP_HOST = "smtp.invalid.example";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "alerts@omd-dz.com";
  process.env.SMTP_PASSWORD = "x";
  process.env.ALERT_EMAIL_TO = "service.carburant.omd@omd-dz.com";
  warnings = await sendStationStopEmails([alert]);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
} catch (err) {
  threw = (err as Error).message;
}
check("an unreachable mail host does not throw", threw === null, threw ?? "");
check("it reports the failure as a warning instead", warnings.length > 0, JSON.stringify(warnings));

let emptyThrew: string | null = null;
let emptyWarnings: string[] = [];
try {
  emptyWarnings = await sendStationStopEmails([]);
} catch (err) {
  emptyThrew = (err as Error).message;
}
check("no alerts is a no-op", emptyThrew === null && emptyWarnings.length === 0);

await withEnvAsync();
async function withEnvAsync(): Promise<void> {
  const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  try {
    const w = await sendStationStopEmails([alert]);
    check(
      "an unconfigured deployment says 'skipped', and sends nothing",
      w.length === 1 && w[0].startsWith("email skipped:"),
      JSON.stringify(w),
    );
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log("\nAll station-email checks passed.\n");
