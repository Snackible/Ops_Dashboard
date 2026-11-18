import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth/AuthContext";
import { dataClient } from "../lib/data";
import { ThemeToggle } from "../theme/ThemeToggle";
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from "../lib/passwordRules";

type NewRole = "ops" | "b2b";

export function SignupPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<NewRole>("b2b");
  const [masterPassword, setMasterPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await dataClient.createUser(username.trim(), password, role, masterPassword);
      const user = await dataClient.login(username.trim(), password);
      signIn(user);
      navigate(user.role === "b2b" ? "/b2b" : "/ops");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the user");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent";

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10 text-ink">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wide text-accent-ink">Ops x B2B dashboard</p>
          <h1 className="mt-2 font-display text-2xl font-semibold">New user</h1>
        </div>

        <form onSubmit={handleSubmit} className="surface space-y-4 rounded-2xl p-6">
          <label className="block">
            <span className="text-sm text-ink-soft">Name</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Priya"
              autoFocus
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="text-sm text-ink-soft">Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
              maxLength={PASSWORD_MAX}
              placeholder={`At least ${PASSWORD_MIN} characters`}
              className={inputClass}
            />
          </label>

          <div>
            <span className="text-sm text-ink-soft">Dashboard</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(["b2b", "ops"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    role === r ? "border-accent bg-accent-soft font-medium text-accent-ink" : "border-line text-ink-soft hover:text-ink"
                  }`}
                >
                  {r === "b2b" ? "B2B" : "Ops"}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-sm text-ink-soft">Master password</span>
            <input
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder="Required to create a user"
              className={inputClass}
            />
          </label>

          {error && <p className="text-[13px] text-danger">{error}</p>}

          <button
            type="submit"
            disabled={busy || username.trim() === "" || passwordProblem(password) !== null || masterPassword === ""}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create user"}
          </button>
        </form>

        <p className="mt-5 text-center text-[13px] text-ink-soft">
          Already have a login?{" "}
          <Link to="/login" className="font-medium text-accent-ink hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
