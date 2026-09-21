import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth/AuthContext";
import { ThemeToggle } from "../theme/ThemeToggle";

export function LoginPage() {
  const [name, setName] = useState("");
  const { signIn } = useAuth();
  const navigate = useNavigate();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    signIn({ id: "ops-" + (name || "team"), name: name || "Ops Team", role: "ops" });
    navigate("/ops");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wide text-accent-ink">Snackible Ops Dashboard</p>
          <h1 className="mt-2 font-display text-2xl font-semibold">Ops sign in</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-line bg-paper-raised p-6 shadow-card">
          <label className="block">
            <span className="text-sm text-ink-soft">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya"
              className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.98]"
          >
            Continue
          </button>
          <p className="text-center text-[11px] text-ink-faint">
            Demo mode — mock authentication, no password required yet.
          </p>
        </form>

        <p className="mt-4 text-center text-[12px] text-ink-faint">
          Testing the B2B side?{" "}
          <button onClick={() => navigate("/b2b")} className="text-accent-ink underline underline-offset-2">
            Skip sign-in →
          </button>
        </p>
      </div>
    </div>
  );
}
