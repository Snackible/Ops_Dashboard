const url = import.meta.env.VITE_SHEETS_API_URL as string | undefined;
const token = import.meta.env.VITE_SHEETS_API_TOKEN as string | undefined;

export const isSheetsConfigured = Boolean(url);

/**
 * Calls the Apps Script web app (see apps-script/Code.gs).
 *
 * The content type is deliberately text/plain: that keeps this a CORS
 * "simple request", and Apps Script web apps cannot answer the preflight
 * OPTIONS that application/json would trigger. The body is still JSON.
 */
export async function callSheets<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!url) throw new Error("Google Sheets backend is not configured - set VITE_SHEETS_API_URL");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, token, ...params }),
    redirect: "follow",
  });

  if (!response.ok) throw new Error(`Sheets backend returned ${response.status}`);

  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!payload.ok) throw new Error(payload.error ?? "Sheets request failed");
  return payload.data as T;
}
