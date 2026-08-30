// Generated alert tones (Web Audio oscillator beeps) — no audio files needed.
// Distinct pitch/pattern per notification kind so operators can tell severity apart by ear.
//
// THE TONES WERE SILENT IN PRACTICE, and none of the wiring was wrong.
// An AudioContext constructed before the user has interacted with the
// page starts in state "suspended", and resume() is only honoured from
// inside a user gesture. Every alert here arrives on a Supabase realtime
// websocket message — as far as the browser is concerned that is not a
// gesture, so the resume was refused, the context stayed suspended, and
// each beep was scheduled into a context that never ran. No error, no
// warning, just nothing.
//
// So the context is PRIMED on the first click or keypress instead (see
// primeAlertAudio, called from AlertToaster), and after that any later
// tone plays from any callback.

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

/**
 * Unlock audio. Call from a real user gesture — a click, a key, a touch.
 *
 * Idempotent and cheap, so it is safe to call on every early gesture
 * until it takes. The silent blip is not superfluous: Safari and iOS
 * treat a context as unlocked only once a node has actually been played
 * through it inside the gesture, so resume() alone leaves them muted.
 * At zero gain nobody hears it.
 *
 * Returns whether the context is running, so a caller can tell the
 * difference between "unlocked" and "the browser still refuses".
 */
export function primeAlertAudio(): boolean {
  const ctx = getContext();
  if (!ctx) return false;

  if (ctx.state === "suspended") {
    // Fire and forget, but CATCH: an unhandled rejection here is what
    // fills a dispatcher's console with red on a page that looks fine.
    void ctx.resume().catch(() => {});
  }

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch {
    // A context that refuses to build a node is one we cannot unlock;
    // the caller keeps listening for the next gesture.
  }

  return ctx.state === "running";
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
  // Best effort only, and it is EXPECTED to fail when it matters: this
  // runs from a websocket callback, not a gesture. primeAlertAudio is
  // what actually unlocks the context. Kept because a context suspended
  // by a backgrounded tab — rather than by the autoplay policy — does
  // resume from here, and caught so a refusal is not an unhandled
  // rejection in the console.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

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
    case "station_stop":
      // Same silence hq_arrival used to have: the kind shipped without a
      // case here, so a truck stopped at a station known to take money
      // from drivers arrived in the feed without a sound. Low and
      // repeated — it shares off_route's urgency but not its pitch, so
      // "he is off the road" and "he is at that station" don't sound
      // like the same alarm.
      beep(300, 170, 0);
      beep(300, 170, 0.22);
      beep(300, 240, 0.44);
      break;
  }
}
