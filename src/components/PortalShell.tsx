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
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 font-display text-base font-semibold sm:text-lg">Snackible</span>
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-ink-soft sm:px-2.5 sm:py-1 sm:text-[11px]">
                {brandLabel}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <span className="hidden text-sm text-ink-soft sm:inline">{user?.name}</span>
              <ThemeToggle />
              <button
                onClick={handleSignOut}
                className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-soft transition-colors hover:text-ink hover:border-ink-faint active:scale-[0.97] sm:px-3 sm:py-1.5 sm:text-[13px]"
              >
                Sign out
              </button>
            </div>
          </div>
          <nav className="-mx-4 mt-2.5 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive ? "bg-accent-soft text-accent-ink font-medium" : "text-ink-soft hover:text-ink hover:bg-paper-raised"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
