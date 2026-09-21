// Real backend calls always go to `/api/sheets` — same origin as the app
// itself (a Vercel serverless function, see api/sheets.js), so there's no
// separate URL to configure and no CORS to work around. Production builds
// use it automatically; local `npm run dev` (plain Vite, no functions
// running) stays on the mock unless VITE_USE_SHEETS_API=true and you're
// running `vercel dev` instead, which serves both together.
export const isSheetsConfigured = import.meta.env.PROD || import.meta.env.VITE_USE_SHEETS_API === "true";

/**
 * Turns raw backend errors into something worth showing someone who isn't
 * debugging the app - a Google API quota message or an internal "Server
 * busy" both mean the same thing to a user: try again shortly.
 */
function friendlyError(raw: string): string {
  if (/quota exceeded/i.test(raw) || /server busy/i.test(raw)) {
    return "Ops is busy right now — please try again in a minute.";
  }
  return raw;
}

export async function callSheets<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });

  if (!response.ok) throw new Error(friendlyError(`Sheets backend returned ${response.status}`));

  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!payload.ok) throw new Error(friendlyError(payload.error ?? "Sheets request failed"));
  return payload.data as T;
}
