import type { AuthUser } from "../types";

const STORAGE_KEY = "snackible-ops-auth-user";

type Listener = (user: AuthUser | null) => void;

let currentUser: AuthUser | null = loadUser();
const listeners = new Set<Listener>();

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function signIn(user: AuthUser): void {
  currentUser = user;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  for (const l of listeners) l(currentUser);
}

export function signOut(): void {
  currentUser = null;
  localStorage.removeItem(STORAGE_KEY);
  for (const l of listeners) l(currentUser);
}

export function subscribeAuth(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
