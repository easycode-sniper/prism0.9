"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, MessageCircle, Route, Fuel, Banknote, Gauge, Scale, Truck } from "lucide-react";
import { signIn } from "@/lib/supabase/actions";
import { LoginMapBackground } from "@/components/layout/LoginMapBackground";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Support routes off this page. Built once at module scope rather than
// inline so the encoding stays in one place — a raw newline or "&" in a
// mailto body silently truncates the draft in some clients.
const OWNER_EMAIL = "ferdjellahsouhaibomd@gmail.com";
// wa.me wants the number in E.164 with no "+" and no separators.
const OWNER_WHATSAPP = "213666353739";

const INVITE_MAILTO =
  `mailto:${OWNER_EMAIL}?subject=${encodeURIComponent("Prism access request")}` +
  `&body=${encodeURIComponent("Name:\nCompany/Role:\nReason for access:\n")}`;

const FEEDBACK_MAILTO =
  `mailto:${OWNER_EMAIL}?subject=${encodeURIComponent("Prism feedback")}` +
  `&body=${encodeURIComponent("What happened:\n\nWhat you expected:\n\nPage/screen:\n")}`;

const WHATSAPP_URL =
  `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent("Hello — I'm contacting you about Prism.")}`;

// ── The hero panel's figures ─────────────────────────────────────
// ILLUSTRATIVE, deliberately not the fleet's — the owner's call, since
// this page renders unauthenticated and real totals would hand the
// fleet's size and spend to anyone with the URL. Same for the status
// counts below: plausible, static, nobody's.
//
// Icon plus amount plus the tone arrow, nothing else: no labels, no
// captions, so there is nothing in them to squeeze — and the arrow
// keeps its dashboard meaning (direction is not tone: consumption
// falling reads green, variance rising reads red).
const HERO_KPIS: {
  icon: typeof Route;
  value: number;
  unit: string;
  decimals?: number;
  delta: number;
  bad?: boolean;
}[] = [
  { icon: Route, value: 842150, unit: "km", delta: 0.084 },
  { icon: Fuel, value: 301470, unit: "L", delta: 0.061 },
  { icon: Banknote, value: 9845200, unit: "DA", delta: 0.073 },
  { icon: Gauge, value: 35.8, unit: "L/100km", decimals: 1, delta: -0.021 },
  { icon: Scale, value: 312750, unit: "DA", delta: 0.046, bad: true },
  // Six cards, not five: the grid lands three-by-three instead of
  // leaving a widowed cell that reads as a missing card. Truck count,
  // coherent with the status strip below it (36 of these on route).
  { icon: Truck, value: 64, unit: "", delta: 0.016 },
];

// Likewise illustrative. Off-route and sites stay cream: on a panel
// that cannot know the fleet's state, spending red or pink would imply
// a live alert the page has no way to have read.
const HERO_STATUS: { value: number; label: string; color: string }[] = [
  { value: 36, label: "On route", color: "var(--green)" },
  { value: 12, label: "Idle", color: "var(--amber)" },
  { value: 5, label: "Parking", color: "var(--cyan)" },
  { value: 2, label: "Off route", color: "var(--text)" },
  { value: 4, label: "Sites", color: "var(--text)" },
];

/** Locale-aware figure for the hero strip: French groups in narrow
 *  spaces where English groups in commas, and the strip must read
 *  correctly in both card languages. */
function int(n: number, decimals: number, language: string): string {
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** One-decimal share, French-style ("8,4 %") where French is on. */
function pct(f: number, language: string): string {
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(f);
}

export default function LoginPage() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Cheap checks first — a typo'd address shouldn't cost a round trip to
    // Supabase just to come back as "invalid login credentials".
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setError(null);
    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      setError(error);
      setLoading(false);
      return;
    }

    router.refresh();
  }

  return (
    <div className="signin-page signin-page--split">
      <section className="signin-hero" aria-label="Prism">
        <LoginMapBackground />
        <div className="signin-hero__inner">
          <p className="signin-live">
            <span className="signin-live__dot" aria-hidden="true" />
            LIVE · DZ
          </p>

          <p className="signin-welcome">{t("Welcome back")}</p>

          <div className="signin-kpis">
            {HERO_KPIS.map((k, i) => (
              <div key={i} className="signin-kpi">
                <k.icon size={14} strokeWidth={2} aria-hidden="true" className="signin-kpi__icon" />
                <span className="signin-kpi__value">
                  {int(k.value, k.decimals ?? 0, language)} <small>{k.unit}</small>
                </span>
                <span className={`signin-kpi__trend${k.bad ? " signin-kpi__trend--bad" : ""}`}>
                  {k.delta >= 0 ? "▲" : "▼"} {pct(Math.abs(k.delta), language)}
                </span>
              </div>
            ))}
          </div>

          <div className="signin-hero__copy">
            <h1 className="signin-h1">
              {t("Continuous live tracking,")} <span>{t("maximum efficiency.")}</span>
            </h1>
            <p className="signin-desc">
              {t("Real-time GPS control, automated route adherence, and instant fuel variance for your entire fleet.")}
            </p>
            <div className="signin-status">
              {HERO_STATUS.map((s) => (
                <div key={s.label} className="signin-stat">
                  <strong style={{ color: s.color }}>{s.value}</strong>
                  <span>{t(s.label)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="signin-side">
        <main className="glass signin-card">
        {/* The one place the language can be chosen before signing in.
            I18nProvider keeps a copy in localStorage precisely so this
            screen can render in the operator's language, but setLanguage
            was only reachable from the topbar — behind the login — so a
            first visit, a new phone or cleared site data always landed in
            English with no way out of it.

            en/fr only, not the topbar's three: the ar dictionary covers
            none of the strings on this card, so picking it would flip the
            page to RTL and leave every word English — worse than the
            default it replaced. Adding "ar" here is a one-word change
            once that dictionary covers the sign-in screen. */}
        <LanguageSwitcher codes={["en", "fr"]} className="signin-lang" />

        <span className="signin-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/prism-mark.svg" alt="" width={28} height={28} />
        </span>

        {/* Prism is a name, not copy: it reads the same in every
            language and is deliberately not passed through t(). */}
        <h1 className="signin-title">Prism</h1>

        <form onSubmit={handleSubmit} className="signin-form" noValidate>
          <fieldset disabled={loading} className="signin-fields">
            <label htmlFor="email" className="sr-only">{t("Email")}</label>
            <input
              id="email"
              name="email"
              type="email"
              className="signin-field"
              placeholder={t("Email")}
              autoComplete="username"
              autoFocus
              aria-invalid={error ? true : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label htmlFor="password" className="sr-only">{t("Password")}</label>
            <div className="signin-password">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                className="signin-field"
                placeholder={t("Password")}
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="signin-reveal"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t("Hide password") : t("Show password")}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} strokeWidth={2} /> : <Eye size={15} strokeWidth={2} />}
              </button>
            </div>

            {/* Live region, not a bare div: focus never moves on a failed
                submit, so without this a screen-reader user is told nothing. */}
            <div role="alert" aria-live="polite">
              {/* t() on a value rather than a literal, which is exactly what
                  keying translations by their English text buys here: this
                  string may be one of ours or may be Supabase's own
                  ("Invalid login credentials"). The ones we know are
                  translated; anything else falls through unchanged instead
                  of turning into a missing-key placeholder. */}
              {error && <p className="signin-error">{t(error)}</p>}
            </div>

            <hr className="signin-rule" />

            <button type="submit" className="signin-submit">
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  {t("Signing in…")}
                </>
              ) : (
                t("Sign in")
              )}
            </button>
          </fieldset>
        </form>

        <p className="signin-foot">
          {t("No account?")}{" "}
          <a href={INVITE_MAILTO}>
            {t("Request an invite")}
          </a>
        </p>

        {/* Two ways to reach the owner from the one screen a signed-out
            person can actually see. Deliberately links, not a form: this
            page is public, so anything that posts from here is an
            unauthenticated write endpoint. */}
        <div className="signin-contact">
          <a className="signin-contact__link" href={FEEDBACK_MAILTO}>
            <Mail size={13} strokeWidth={2} aria-hidden="true" />
            {t("Send feedback")}
          </a>
          <a
            className="signin-contact__link"
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={13} strokeWidth={2} aria-hidden="true" />
            {t("Contact on WhatsApp")}
          </a>
        </div>
        </main>
      </section>
    </div>
  );
}
