"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/supabase/actions";
import { LoginMapBackground } from "@/components/layout/LoginMapBackground";
import { TruckArrivalScene } from "@/components/layout/TruckArrivalScene";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    <div className="relative flex min-h-screen items-center justify-center p-4" style={{ background: "var(--bg)" }}>
      <LoginMapBackground />

      <div
        className="relative z-10 grid w-full max-w-3xl overflow-hidden md:grid-cols-2"
        style={{ border: "1px solid var(--line)", borderRadius: "14px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
      >
        {/* Welcome panel */}
        <div
          className="flex flex-col justify-between gap-8 p-8"
          style={{ background: "linear-gradient(160deg, var(--panel-2) 0%, #0d0d18 100%)" }}
        >
          <div>
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "var(--indigo)" }}>
              <span className="text-lg font-bold text-white">P</span>
            </div>
            <h1 className="text-xl font-semibold text-white">Welcome to Prism</h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
              Real-time GPS dispatch and route tracking for OMD Transport&rsquo;s cement fleet —
              every truck, every route, every arrival, live.
            </p>
          </div>
          <TruckArrivalScene />
        </div>

        {/* Sign-in panel */}
        <div className="p-8" style={{ background: "var(--panel)" }}>
          <h2 className="text-lg font-semibold text-white">Sign in</h2>
          <p className="mt-1 mb-6 text-sm" style={{ color: "var(--text-dim)" }}>Enter your credentials to continue.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium" style={{ color: "var(--text-dim)" }}>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium" style={{ color: "var(--text-dim)" }}>Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1"
              />
            </div>

            {error && (
              <div className="rounded-lg p-3 text-sm" style={{ background: "var(--red-subtle, rgba(248,113,113,0.08))", border: "1px solid rgba(248,113,113,0.35)", color: "var(--red)" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
