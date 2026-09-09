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

  return (
    <AuthContext.Provider value={{ user, signIn: storeSignIn, signOut: storeSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
