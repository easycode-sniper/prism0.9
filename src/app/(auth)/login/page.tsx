"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, MessageCircle } from "lucide-react";
import { signIn } from "@/lib/supabase/actions";
import { LoginMapBackground } from "@/components/layout/LoginMapBackground";
import { useTranslation } from "@/lib/i18n/I18nProvider";

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

export default function LoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
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
    <div className="signin-page">
      <LoginMapBackground />


      <main className="glass signin-card">
        <span className="signin-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/omd-logo.png" alt="" width={26} height={26} />
        </span>

        {/* Prism and OMD are names, not copy: they read the same in every
            language and are deliberately not passed through t(). */}
        <h1 className="signin-title">Prism</h1>
        <p className="signin-sub">{t("OMD Fleet Operations")}</p>

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
    </div>
  );
}
