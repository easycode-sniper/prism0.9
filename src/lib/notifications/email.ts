// Email delivery for alerts that someone has to act on away from the
// screen. Right now that is one kind: a truck stopped at a blacklisted
// station, which the fuel desk needs while the truck is still there.
//
// SMTP rather than an HTTP mail API because the alert goes out through
// OMD's own mailbox, so the fuel desk sees it arrive from an address
// they recognise and no third party holds a copy. That is also why this
// is the one place the "no SDK dependency" rule bends: the app talks to
// Wialon and Google over plain fetch, but SMTP is a stateful TLS
// conversation with AUTH, and hand-rolling one is not the same class of
// job as posting JSON.
//
// NOT a "use server" module, for the reason lib/fuel/googleSheets.ts is
// not: every export of one becomes a public HTTP endpoint, and this
// holds a mailbox password that must never be reachable from a browser.

import nodemailer, { type Transporter } from "nodemailer";
import { OPS_TIMEZONE } from "../format.ts";

export interface StationStopAlert {
  truckId: string;
  driverName: string | null;
  stationName: string;
  /** When the stop was detected. Defaults to now. */
  at?: Date;
}

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string[];
}

/**
 * Read the mail settings out of the environment, or say which ones are
 * missing.
 *
 * Returns a reason rather than throwing, and the caller treats a missing
 * config as "email is switched off" rather than as a failure. The tick
 * has to keep running on a deployment where nobody has set these — the
 * in-app notification is the system of record, and the email is a copy.
 */
export function readConfig(): { config: MailConfig } | { reason: string } {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  const to = (process.env.ALERT_EMAIL_TO ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  const missing: string[] = [];
  if (!host) missing.push("SMTP_HOST");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASSWORD");
  if (to.length === 0) missing.push("ALERT_EMAIL_TO");
  if (missing.length > 0) return { reason: `not configured (${missing.join(", ")})` };

  // 465 is implicit TLS, 587 is STARTTLS. Defaulting to 587 rather than
  // 465 because it is what Microsoft 365 and Google Workspace both want,
  // and getting this pair wrong is the single most common way an SMTP
  // send hangs instead of failing.
  const port = Number(process.env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { reason: `SMTP_PORT is not a valid port: ${process.env.SMTP_PORT}` };
  }

  return {
    config: {
      host: host!,
      port,
      secure: port === 465,
      user: user!,
      pass: pass!,
      // Most providers refuse to send with a From that is not the
      // authenticated mailbox (or an alias of it), so the default is the
      // login itself rather than something prettier.
      from: process.env.ALERT_EMAIL_FROM?.trim() || user!,
      to,
    },
  };
}

/**
 * Timestamps in Algiers, always.
 *
 * lib/format's helpers pin the LOCALE but not the zone, which is correct
 * in the browser — an operator's machine is already on Algeria time. This
 * runs in a Vercel function whose clock is UTC, so an unpinned format
 * would put 08:56 in the app and 07:56 in the email about the same stop.
 */
export function stampAlgiers(at: Date): string {
  const opts = { timeZone: OPS_TIMEZONE } as const;
  const date = at.toLocaleDateString("en-GB", {
    ...opts,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = at.toLocaleTimeString("en-GB", {
    ...opts,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // Space, not toLocaleString's comma: formatDateTime renders
  // "07/09/2026 14:05" and the email must not spell the same instant
  // differently from the screen it is a copy of.
  return `${date} ${time}`;
}

export function subjectFor(alert: StationStopAlert): string {
  return `Stopped at a blacklisted station — ${alert.truckId}`;
}

/** Deliberately the same sentence the in-app notification carries, so the
 *  mailbox and the app never appear to describe different events. */
export function bodyFor(alert: StationStopAlert, at: Date): { text: string; html: string } {
  const lines = [
    `${alert.truckId} has stopped at ${alert.stationName}.`,
    "",
    `Truck:    ${alert.truckId}`,
    `Station:  ${alert.stationName}`,
    `Driver:   ${alert.driverName ?? "unknown"}`,
    `Time:     ${stampAlgiers(at)} (Africa/Algiers)`,
    "",
    "This station is on Prism's blacklist, so a stop there is flagged",
    "while the truck is still on the forecourt.",
    "",
    "Open Prism: https://prism0-9.vercel.app/notifications",
    "",
    "— Prism, automatically. Nobody is monitoring replies to this address.",
  ];

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111">
  <p style="font-size:16px;margin:0 0 12px"><strong>${esc(alert.truckId)}</strong> has stopped at <strong>${esc(alert.stationName)}</strong>.</p>
  <table cellpadding="4" style="border-collapse:collapse;font-size:14px">
    <tr><td style="color:#666">Truck</td><td><strong>${esc(alert.truckId)}</strong></td></tr>
    <tr><td style="color:#666">Station</td><td>${esc(alert.stationName)}</td></tr>
    <tr><td style="color:#666">Driver</td><td>${esc(alert.driverName ?? "unknown")}</td></tr>
    <tr><td style="color:#666">Time</td><td>${esc(stampAlgiers(at))} (Africa/Algiers)</td></tr>
  </table>
  <p style="color:#444">This station is on Prism's blacklist, so a stop there is flagged while the truck is still on the forecourt.</p>
  <p><a href="https://prism0-9.vercel.app/notifications">Open Prism</a></p>
  <p style="color:#888;font-size:12px">Prism, automatically. Nobody is monitoring replies to this address.</p>
</div>`;

  return { text: lines.join("\n"), html };
}

/**
 * Send one email per alert.
 *
 * NEVER THROWS, and that is the contract that matters. It is called from
 * runBlacklistedStationCheck once the notifications row is already
 * written, and that function's other writes throw on purpose because a
 * written flag with no alert silently suppresses the alert. An email is
 * not in that class: the alert exists in the app whether or not the mail
 * server answers, so a mail failure must cost nothing but a warning.
 *
 * Returns the warnings, which the tick collects and /api/tick reports.
 */
export async function sendStationStopEmails(alerts: StationStopAlert[]): Promise<string[]> {
  if (alerts.length === 0) return [];

  const read = readConfig();
  if ("reason" in read) return [`email skipped: ${read.reason}`];
  const { config } = read;

  const warnings: string[] = [];
  let transport: Transporter | null = null;

  try {
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      // A tick is one serverless invocation with a hard duration cap, and
      // an unreachable mail host would otherwise hold it open until the
      // platform kills it — taking the whole tick's result with it. Ten
      // seconds is generous for a handshake and cheap to lose.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });

    for (const alert of alerts) {
      const at = alert.at ?? new Date();
      const { text, html } = bodyFor(alert, at);
      try {
        await transport.sendMail({
          from: config.from,
          to: config.to,
          subject: subjectFor(alert),
          text,
          html,
        });
      } catch (err) {
        // Per alert, so one bad address or one rejected recipient does
        // not silently drop the rest of the batch.
        warnings.push(`email for ${alert.truckId} failed: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    warnings.push(`email transport failed: ${(err as Error).message}`);
  } finally {
    transport?.close();
  }

  return warnings;
}
