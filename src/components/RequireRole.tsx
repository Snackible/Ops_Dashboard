import { Navigate } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "../lib/auth/AuthContext";
import type { Role } from "../lib/types";

/**
 * Testing-only shortcut: the B2B side has no real auth yet anyway (see
 * LoginPage), so instead of gating it on picking an account that may not
 * exist in whatever backend is configured, anyone hitting a /b2b route
 * auto-signs-in as this fixed identity. Remove this the moment real B2B
 * auth exists.
 */
const TEST_B2B_USER = { id: "test-b2b", name: "Test Buyer", role: "b2b" as const, accountId: "test-b2b" };

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, signIn } = useAuth();

  useEffect(() => {
    if (!user && role === "b2b") signIn(TEST_B2B_USER);
  }, [user, role, signIn]);

  if (!user) {
    if (role === "b2b") return null; // signing in via the effect above
    return <Navigate to="/login" replace />;
  }
  if (user.role !== role) return <Navigate to={user.role === "ops" ? "/ops" : "/b2b"} replace />;
  return <>{children}</>;
}
