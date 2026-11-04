/**
 * pinVault - store login PINs as salted hashes instead of plain text, and
 * upgrade any plain-text PIN it finds the next time a dashboard runs.
 *
 * SELF-CONTAINED ON PURPOSE: this file only uses node:crypto. To use it in
 * another dashboard that shares the same Users sheet, copy this one file in
 * and follow "Adding it to another dashboard" below. Nothing here knows about
 * Google Sheets, React or this app - storage is passed in as two callbacks.
 *
 * What gets stored
 *   scrypt1$<salt>$<hash>    PIN hashed with scrypt (random per-PIN salt)
 *   scrypt1p$<salt>$<hash>   same, but keyed with the PIN_PEPPER secret first
 * Anything else in the PIN column is treated as a legacy plain-text PIN: it
 * still works for login (so nobody is locked out mid-rollout) and is replaced
 * by a hash by secureStoredPins().
 *
 * This is a one-way hash, not reversible encryption - nobody (including the
 * sheet owner) can read a PIN back. A forgotten PIN is reset by typing a new
 * plain-text one into the cell; it is hashed on the next run.
 *
 * PIN_PEPPER (optional but recommended): a 4-digit PIN only has 10,000
 * possibilities, so a plain hash can be brute-forced in milliseconds by
 * anyone who can read the sheet. A pepper is a secret kept in the server's
 * environment (NOT in the sheet), which makes the sheet contents useless
 * on their own. Every dashboard sharing the sheet must have the SAME pepper
 * value. Set it before the first run: PINs hashed without one stay valid, but
 * a PIN hashed with one can't be verified by a dashboard that lacks it.
 *
 * Adding it to another dashboard
 *   1. Copy this file in (e.g. server/lib/pinVault.js).
 *   2. Where you check a login:   if (await verifyPin(typed, row.password)) ...
 *   3. Where you create a user:   password: await hashPin(pin)
 *   4. On start-up / first login: await secureStoredPins({ rows, writeCells })
 *      with `rows` = the Users rows (each with a `password` and a row number)
 *      and `writeCells` writing the new values back. See server/actions.js
 *      (secureLogins) for a complete Google Sheets example.
 *   5. Set the same PIN_PEPPER env var everywhere (if you use one).
 *   Until step 2 is done in EVERY dashboard, don't run step 4 in any of them -
 *   a dashboard that still compares plain text can't log anyone in once their
 *   PIN is hashed.
 */
import { randomBytes, scrypt, timingSafeEqual, createHmac, createHash } from "node:crypto";

const TAG = "scrypt1";
const TAG_PEPPERED = "scrypt1p";
const KEY_LEN = 32;
// Fixed with the format tag. Changing these means introducing "scrypt2".
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function derive(secret, salt) {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LEN, SCRYPT_PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function pepper() {
  return process.env.PIN_PEPPER || "";
}

function applyPepper(pin, key) {
  return key ? createHmac("sha256", key).update(pin).digest() : Buffer.from(pin, "utf8");
}

/** True if the stored value is already one of ours (a hash), false for a plain-text PIN or blank. */
export function isEncrypted(stored) {
  const s = String(stored ?? "");
  return s.startsWith(TAG + "$") || s.startsWith(TAG_PEPPERED + "$");
}

/** Hashes a PIN for storage. Uses PIN_PEPPER when it's set. */
export async function hashPin(pin) {
  const clean = String(pin ?? "");
  if (!clean) throw new Error("PIN is empty");
  const key = pepper();
  const salt = randomBytes(16);
  const hash = await derive(applyPepper(clean, key), salt);
  return `${key ? TAG_PEPPERED : TAG}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Equal-time comparison of two strings (hashed first so lengths don't leak). */
function safeEqualText(a, b) {
  const da = createHash("sha256").update(String(a)).digest();
  const db = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(da, db);
}

/**
 * Does `typed` match what's stored? Works for hashes and for legacy plain-text
 * PINs, so it's safe to ship before the sheet has been upgraded.
 */
export async function verifyPin(typed, stored) {
  const input = String(typed ?? "");
  const value = String(stored ?? "");
  if (!input || !value) return false;
  if (!isEncrypted(value)) return safeEqualText(input, value);

  const [tag, saltText, hashText] = value.split("$");
  if (!saltText || !hashText) return false;
  let key = "";
  if (tag === TAG_PEPPERED) {
    key = pepper();
    if (!key) throw new Error("This PIN was hashed with PIN_PEPPER, but PIN_PEPPER isn't set on this server");
  }
  const expected = Buffer.from(hashText, "base64url");
  const actual = await derive(applyPepper(input, key), Buffer.from(saltText, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Finds plain-text PINs and replaces them with hashes. Idempotent - a sheet
 * with nothing to upgrade costs no writes. Returns how many it upgraded.
 *
 *   rows         the user rows you've already read: [{ __row, password, ... }]
 *                (`__row` is whatever your writeCells needs to find the row)
 *   readRows     () => rows, called again just before writing to confirm each
 *                row still holds the same plain-text PIN (so a row inserted or
 *                deleted in the meantime can't get a hash written over it)
 *   writeCells   ([{ row, value }]) => void, writes the new values
 *   field        which property holds the PIN, default "password"
 */
export async function secureStoredPins({ rows, readRows, writeCells, field = "password" }) {
  const plain = rows.filter((r) => String(r[field] ?? "").trim() !== "" && !isEncrypted(r[field]));
  if (plain.length === 0) return 0;

  const fresh = await readRows();
  const stillPlain = plain.filter((r) => fresh.some((f) => f.__row === r.__row && String(f[field]) === String(r[field])));
  if (stillPlain.length === 0) return 0;

  const updates = [];
  for (const r of stillPlain) updates.push({ row: r.__row, value: await hashPin(r[field]) });
  await writeCells(updates);
  // Keep the caller's in-memory rows in step so the rest of this request sees hashes.
  for (const u of updates) {
    const r = rows.find((x) => x.__row === u.row);
    if (r) r[field] = u.value;
  }
  return updates.length;
}
