import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUser } from "../types";
import { getCurrentUser, signIn as storeSignIn, signOut as storeSignOut, subscribeAuth } from "./authStore";

interface AuthContextValue {
  user: AuthUser | null;
  signIn: (user: AuthUser) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getCurrentUser());

  useEffect(() => subscribeAuth(setUser), []);

  // Update local state directly rather than relying only on the subscription -
  // a caller effect (e.g. RequireRole's auto sign-in) can fire before this
  // provider's own subscribeAuth effect has run, since React fires child
  // effects before parent effects on mount, and that update would otherwise
  // be silently lost.
  function signIn(next: AuthUser) {
    storeSignIn(next);
    setUser(next);
  }

  function signOut() {
    storeSignOut();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
