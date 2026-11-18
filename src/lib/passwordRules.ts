/**
 * The rule for a NEW password (signup, reset). Matches the other dashboards that share the Users sheet
 * (see server/lib/usersTable.js). Sign-in itself accepts any length, so existing shorter passwords - the
 * old 4-digit codes - keep working until someone changes them.
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 100;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  return null;
}
