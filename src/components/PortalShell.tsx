import { NavLink, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { ThemeToggle } from "../theme/ThemeToggle";
import { useAuth } from "../lib/auth/AuthContext";

interface PortalShellProps {
  brandLabel: string;
  navItems: { to: string; label: string }[];
  children: ReactNode;
}

export function PortalShell({ brandLabel, navItems, children }: PortalShellProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    const wasB2B = user?.role === "b2b";
    signOut();
    // B2B has no real session to sign out of (see RequireRole's bypass) and
    // /login unconditionally fetches accounts, which errors loudly if the
    // Accounts tab isn't set up - skip it entirely, straight back to /b2b.
    navigate(wasB2B ? "/b2b" : "/login");
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <span className="font-display text-lg font-semibold">Snackible</span>
            <span className="rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-ink-soft">
              {brandLabel}
            </span>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm transition-colors ${
                      isActive ? "bg-accent-soft text-accent-ink font-medium" : "text-ink-soft hover:text-ink hover:bg-paper-raised"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-soft">{user?.name}</span>
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink hover:border-ink-faint active:scale-[0.97]"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-6 py-8">
        {children}
      </main>
    </div>
  );
}
