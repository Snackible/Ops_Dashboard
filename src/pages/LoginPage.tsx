import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth/AuthContext";
import { dataClient } from "../lib/data";
import type { B2BAccount, Role } from "../lib/types";
import { ThemeToggle } from "../theme/ThemeToggle";

export function LoginPage() {
  const [role, setRole] = useState<Role>("b2b");
  const [accounts, setAccounts] = useState<B2BAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const { signIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    dataClient.getAccounts().then((list) => {
      setAccounts(list);
      setAccountId(list[0]?.accountId ?? "");
    });
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (role === "b2b") {
      const account = accounts.find((a) => a.accountId === accountId);
      if (!account) return;
      signIn({ id: account.accountId, name: account.contactName, role: "b2b", accountId: account.accountId });
      navigate("/b2b");
    } else {
      signIn({ id: "ops-" + (name || "team"), name: name || "Ops Team", role: "ops" });
      navigate("/ops");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wide text-accent-ink">Snackible Ops Dashboard</p>
          <h1 className="mt-2 font-display text-2xl font-semibold">Sign in</h1>
        </div>

        <div className="mb-6 flex rounded-full border border-line bg-paper-raised p-1">
          {(["b2b", "ops"] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`flex-1 rounded-full py-2 text-sm font-medium transition-all active:scale-[0.98] ${
                role === r ? "bg-accent text-white" : "text-ink-soft hover:text-ink"
              }`}
            >
              {r === "b2b" ? "B2B" : "Ops"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-line bg-paper-raised p-6 shadow-card">
          {role === "b2b" ? (
            <label className="block">
              <span className="text-sm text-ink-soft">Company account</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {accounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.companyName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block">
              <span className="text-sm text-ink-soft">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Priya"
                className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
          )}

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
      </div>
    </div>
  );
}
