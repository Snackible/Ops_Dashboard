import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth/AuthContext";
import { dataClient } from "../lib/data";
import { ThemeToggle } from "../theme/ThemeToggle";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await dataClient.login(username, password);
      signIn(user);
      navigate(user.role === "ops" ? "/ops" : "/b2b");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wide text-accent-ink">Ops x B2B dashboard</p>
          <h1 className="mt-2 font-display text-2xl font-semibold">Sign in</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-line bg-paper-raised p-6 shadow-card">
          <label className="block">
            <span className="text-sm text-ink-soft">Name</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Priya"
              autoFocus
              className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="block">
            <span className="text-sm text-ink-soft">4-digit code</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value.replace(/\D/g, "").slice(0, 4))}
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              placeholder="••••"
              className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm tracking-[0.3em] text-ink placeholder:tracking-normal placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          {error && <p className="text-[13px] text-danger">{error}</p>}

          <button
            type="submit"
            disabled={busy || username.trim() === "" || password.length !== 4}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
