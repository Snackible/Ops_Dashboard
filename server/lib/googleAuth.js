import { google } from "googleapis";

let cachedAuth = null;

/**
 * A JWT client authenticated as the service account, cached per warm
 * function instance (not per request - the JWT client handles its own
 * token refresh internally, so there's no reason to rebuild it).
 *
 * Requires GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 * (both server-only env vars - never VITE_-prefixed, since that would ship
 * them to the browser). The private key is stored with literal "\n" escapes
 * because most env var UIs (Vercel included) don't handle real newlines
 * cleanly; this unescapes them back to real newlines before use.
 */
export function getAuth() {
  if (!cachedAuth) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    if (!email || !rawKey) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are not set");
    }
    cachedAuth = new google.auth.JWT({
      email,
      key: rawKey.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return cachedAuth;
}

export function sheetsApi() {
  return google.sheets({ version: "v4", auth: getAuth() });
}
