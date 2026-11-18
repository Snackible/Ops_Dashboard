import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dataClient } from "../lib/data";
import type { ResetInfo } from "../lib/data/dataClient";
import { Select } from "../components/Select";
import { ThemeToggle } from "../theme/ThemeToggle";
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from "../lib/passwordRules";

/**
 * Lets someone who forgot their code set a new one. Two things are needed, and
 * neither is enough alone: the master password, and the account having been
 * marked in the Users sheet's Reset column by whoever manages the sheet. The
 * server enforces both - this page just can't offer an account nobody marked.
 */
export function ResetPasswordPage() {
  const [info, setInfo] = useState<ResetInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneFor, setDoneFor] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    dataClient
      .getResetInfo()
      .then((r) => live && setInfo(r))
      .catch((err) => live && setLoadError(err instanceof Error ? err.message : "Couldn't load the accounts"));
    return () => {
      live = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await dataClient.resetPassword(username, password, masterPassword);
      setDoneFor(info?.requests.find((r) => r.username === username)?.displayName ?? username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the password");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent";

  let body;
  if (loadError) {
    body = (
      <div className="surface space-y-3 rounded-2xl p-6">
        <p className="text-[13px] text-danger">{loadError}</p>
      </div>
    );
  } else if (!info) {
    body = (
      <div className="surface rounded-2xl p-6">
        <p className="text-sm text-ink-soft">Loading…</p>
      </div>
    );
  } else if (doneFor) {
    body = (
      <div className="surface space-y-3 rounded-2xl p-6">
        <p className="text-sm">
          New password saved for <span className="font-medium">{doneFor}</span>. They can sign in with it now.
        </p>
      </div>
    );
  } else if (!info.enabled) {
    body = (
      <div className="surface rounded-2xl p-6">
        <p className="text-sm text-ink-soft">Resetting a password isn't switched on. The Users sheet needs a master password row.</p>
      </div>
    );
  } else if (info.requests.length === 0) {
    body = (
      <div className="surface rounded-2xl p-6">
        <p className="text-sm text-ink-soft">
          No account is currently marked for a reset. Mark a row's Reset column with <code className="font-mono text-ink">*</code>, or
          contact the AI team for the master admin password.
        </p>
      </div>
    );
  } else {
    body = (
      <form onSubmit={handleSubmit} className="surface space-y-4 rounded-2xl p-6">
        <label className="block">
          <span className="text-sm text-ink-soft">Account</span>
          <Select
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1"
            aria-label="Account to reset"
          >
            <option value="" disabled>
              Choose an account
            </option>
            {info.requests.map((r) => (
              <option key={r.username} value={r.username}>
                {r.displayName}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="text-sm text-ink-soft">New password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            maxLength={PASSWORD_MAX}
            placeholder={`At least ${PASSWORD_MIN} characters`}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-sm text-ink-soft">Master password</span>
          <input
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder="Required to reset a password"
            className={inputClass}
          />
        </label>

        {error && <p className="text-[13px] text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy || username === "" || passwordProblem(password) !== null || masterPassword === ""}
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10 text-ink">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wide text-accent-ink">Ops x B2B dashboard</p>
          <h1 className="mt-2 font-display text-2xl font-semibold">Reset a password</h1>
        </div>

        {body}

        <p className="mt-5 text-center text-[13px] text-ink-soft">
          <Link to="/login" className="font-medium text-accent-ink hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
