"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/supabase/actions";

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
    <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm space-y-6 p-8" style={{ background: "linear-gradient(180deg, var(--panel) 0%, #0d0d18 100%)", border: "1px solid var(--line)", borderRadius: "12px" }}>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl" style={{ background: "var(--indigo)" }}>
            <span className="text-2xl font-bold text-white">P</span>
          </div>
          <h1 className="text-xl font-semibold text-white">Prism</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>Fleet Operations</p>
        </div>

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
  );
}
