"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import { signIn } from "@/lib/supabase/actions";
import { LoginMapBackground } from "@/components/layout/LoginMapBackground";
import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme/ThemeProvider";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Login sits outside the app shell, so there is no ThemeProvider above
  // it — that provider resolves theme from the signed-in user's settings,
  // which by definition don't exist yet. The root layout's bootstrap script
  // has already put the stored theme on <html> before first paint, so this
  // only has to keep writing back to the same two places it reads from.
  //
  // Deliberately no React state: the current theme lives on <html>, where
  // the bootstrap put it. Seeding state from the DOM instead would read it
  // during render, so the server (no `document`, always dark) and the
  // client (light) would emit different icons — a hydration mismatch that
  // makes React re-render the tree and reset data-theme back to the SSR
  // value, undoing the bootstrap on every load. Which icon shows is a
  // styling question, so CSS answers it off the attribute.
  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next: Theme = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private-browsing storage denial shouldn't cost the operator the toggle.
    }
  }

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

      <button
        type="button"
        onClick={toggleTheme}
        className="signin-theme"
        aria-label="Switch between light and dark theme"
      >
        <Sun className="signin-theme-sun" size={16} strokeWidth={2.25} />
        <Moon className="signin-theme-moon" size={16} strokeWidth={2.25} />
      </button>

      <main className="glass signin-card">
        <span className="signin-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/omd-logo.png" alt="" width={26} height={26} />
        </span>

        <h1 className="signin-title">Prism</h1>
        <p className="signin-sub">OMD Fleet Operations</p>

        <form onSubmit={handleSubmit} className="signin-form" noValidate>
          <fieldset disabled={loading} className="signin-fields">
            <label htmlFor="email" className="sr-only">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              className="signin-field"
              placeholder="Email"
              autoComplete="username"
              autoFocus
              aria-invalid={error ? true : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label htmlFor="password" className="sr-only">Password</label>
            <div className="signin-password">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                className="signin-field"
                placeholder="Password"
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="signin-reveal"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} strokeWidth={2.25} /> : <Eye size={15} strokeWidth={2.25} />}
              </button>
            </div>

            {/* Live region, not a bare div: focus never moves on a failed
                submit, so without this a screen-reader user is told nothing. */}
            <div role="alert" aria-live="polite">
              {error && <p className="signin-error">{error}</p>}
            </div>

            <hr className="signin-rule" />

            <button type="submit" className="signin-submit">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </fieldset>
        </form>

        <p className="signin-foot">
          No account?{" "}
          <a href="mailto:ferdjellahsouhaibomd@gmail.com?subject=Prism%20access%20request&body=Name%3A%0ACompany%2FRole%3A%0AReason%20for%20access%3A">
            Request an invite
          </a>
        </p>
      </main>
    </div>
  );
}
