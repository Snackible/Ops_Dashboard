/**
 * The Users sheet, read the way every dashboard on the shared accounts sheet
 * reads it: columns found by their header text (any order), never by position.
 * Other dashboards add columns (Email, Contact, Reset) and reorder them, so a
 * fixed position here would eventually write a password into the wrong cell.
 *
 * Pure functions only (no Sheets calls) so they can be tested on their own.
 * See ACCOUNTS_ADMIN_SETUP.md in the B2B Delivery Tracker repo for the shared
 * rules this follows (master password, Reset column, "***" standing mark).
 */

// Header text, normalised (lower case, punctuation -> single spaces).
const ALIASES = {
  username: ["username", "user name", "user", "login"],
  password: ["password", "pass"],
  role: ["role"],
  account_id: ["account id"],
  display_name: ["display name", "name", "full name"],
  email: ["email", "e mail"],
  contact: ["contact", "whatsapp", "phone"],
  reset: ["reset", "reset password", "password reset", "needs reset"],
};

// Where this app has always kept the first five, used when a header isn't recognised.
const LEGACY_ORDER = ["username", "password", "role", "account_id", "display_name"];

const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** { field: 0-based column index } for every field whose header is present. */
export function mapColumns(headerRow) {
  const cells = (headerRow || []).map(norm);
  const cols = {};
  const taken = new Set();
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const idx = cells.findIndex((c, i) => !taken.has(i) && aliases.includes(c));
    if (idx >= 0) {
      cols[field] = idx;
      taken.add(idx);
    }
  }
  LEGACY_ORDER.forEach((field, i) => {
    if (cols[field] == null && !taken.has(i)) {
      cols[field] = i;
      taken.add(i);
    }
  });
  return cols;
}

/** values = the tab's rows as returned by Sheets (row 1 = headers). Each user keeps its 1-based sheet row in __row. */
export function parseUsers(values) {
  const cols = mapColumns(values[0]);
  const users = [];
  for (let i = 1; i < (values || []).length; i++) {
    const line = values[i] || [];
    const user = { __row: i + 1 };
    for (const field of Object.keys(ALIASES)) user[field] = cols[field] == null ? "" : String(line[cols[field]] ?? "").trim();
    if (user.username === "" && user.password === "") continue;
    users.push(user);
  }
  return { cols, users };
}

/** A new row as an array laid out in the sheet's own column order. */
export function buildUserRow(cols, user) {
  const width = Math.max(...Object.values(cols), -1) + 1;
  const row = Array(width).fill("");
  for (const [field, idx] of Object.entries(cols)) row[idx] = user[field] ?? "";
  return row;
}

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 100;

/** The rule every dashboard on this sheet uses for a NEW password. Existing, shorter ones (old 4-digit codes) still sign in. */
export function passwordProblem(password) {
  const p = String(password ?? "");
  if (p.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (p.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  return null;
}

/** "master-admin" signs in as a full admin everywhere; the raw role is only used to find the master password. */
export const isMasterAdminRole = (role) => /^master[\s_-]?admin$/i.test(String(role ?? "").trim());

/** A mark of exactly *** stays after a reset, for a row that is reset over and over on purpose. */
export const isStandingMark = (mark) => String(mark ?? "").trim() === "***";

/** Accounts someone marked in the Reset column (any mark, "*" by convention) that can actually sign in. */
export function resetRequests(users) {
  return users
    .filter((u) => u.reset !== "" && u.password !== "" && u.username !== "")
    .map((u) => ({ username: u.username, displayName: u.display_name || u.username }));
}

/**
 * The cell writes that carry out a reset, or an Error saying why not. The
 * Reset mark is the second factor: the master password alone must never be
 * enough to reach an account nobody asked to reset. Callers read the sheet
 * fresh right before calling this.
 */
export function planReset({ users, cols, username, passwordHash }) {
  if (cols.reset == null) {
    throw new Error('The Users sheet has no "Reset" column. Add one in row 1, then mark a row with * to ask for a reset.');
  }
  const wanted = String(username ?? "").trim().toLowerCase();
  const row = wanted && users.find((u) => u.username.toLowerCase() === wanted);
  if (!row || row.reset === "" || row.password === "") {
    throw new Error(`${row ? row.username : "That account"} has not asked for a reset (mark its Reset column with *).`);
  }
  const cells = [{ row: row.__row, col: cols.password, value: passwordHash }];
  if (!isStandingMark(row.reset)) cells.push({ row: row.__row, col: cols.reset, value: "" });
  return cells;
}
