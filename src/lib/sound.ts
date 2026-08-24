// Generated alert tones (Web Audio oscillator beeps) — no audio files needed.
// Distinct pitch/pattern per notification kind so operators can tell severity apart by ear.

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedContext) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    sharedContext = new Ctor();
  }
  return sharedContext;
}

function beep(freq: number, durationMs: number, startAt: number, gainValue = 0.15) {
  const ctx = getContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = freq;
  gain.gain.value = gainValue;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  const t = ctx.currentTime + startAt;
  oscillator.start(t);
  gain.gain.setValueAtTime(gainValue, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + durationMs / 1000);
  oscillator.stop(t + durationMs / 1000);
}

import type { NotificationKind } from "@/lib/notifications/kinds";

export type AlertKind = NotificationKind;

export function playAlertTone(kind: string) {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  switch (kind) {
    case "off_route":
      // Urgent: three sharp high beeps
      beep(880, 120, 0);
      beep(880, 120, 0.18);
      beep(880, 120, 0.36);
      break;
    case "speeding":
      // Urgent: two sharp beeps
      beep(740, 150, 0);
      beep(740, 150, 0.2);
      break;
    case "site_approaching":
      // Advance warning: a rising pair, distinct from an arrival's fall,
      // so "get ready" and "it's here" don't sound alike.
      beep(520, 150, 0);
      beep(700, 200, 0.16);
      break;
    case "site_arrival":
    case "factory_arrival":
      // Calm: single soft descending chime
      beep(660, 180, 0);
      beep(440, 220, 0.15);
      break;
    case "hq_arrival":
      // Previously silent: hq_arrival was missing from the union, so the
      // single most frequent alert in the system played nothing. Lower
      // and softer than a site arrival — coming home is routine.
      beep(540, 200, 0);
      beep(380, 240, 0.16);
      break;
  }
}
