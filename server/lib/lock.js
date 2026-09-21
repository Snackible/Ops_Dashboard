import { readRange, writeRange } from "./sheetsClient.js";
import { ensureTabs, TAB_LOCK } from "./managedSheets.js";

const LOCK_STALE_MS = 20000; // a lock older than this is assumed abandoned (crashed function, etc.)
const ACQUIRE_TIMEOUT_MS = 15000;
const RETRY_BASE_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serverless functions have no shared memory across invocations the way
 * Apps Script's LockService had within one script project, so the mutex
 * itself has to live in the sheet: a dedicated Lock tab holding one
 * [token, acquired_at] row. Acquiring is check-write-confirm: read the
 * cell, if it looks free write our own token, then read it back - if it's
 * still ours, we won; if not, someone else's write landed after ours and
 * we back off and retry. That confirm step is what makes this safe enough
 * for this app's actual concurrency (a handful of B2B accounts, not a
 * firehose) even though it isn't a true atomic compare-and-swap.
 */
export async function withLock(spreadsheetId, fn) {
  const sheetIds = await ensureTabs(spreadsheetId, [TAB_LOCK]);
  if (!sheetIds.has(TAB_LOCK)) throw new Error("Could not create Lock tab");

  const token = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  // Row 1 is the header row every managed tab gets on creation ("token",
  // "acquired_at" as literal text) - the lock state itself lives in row 2,
  // otherwise the header text reads back as a permanently-held, unparseable
  // lock (its "acquired_at" is the literal string "acquired_at", which
  // parses to an invalid date, so the staleness check can never fire).
  while (Date.now() < deadline) {
    const [current] = await readRange(spreadsheetId, TAB_LOCK, "A2:B2");
    const [currentToken, acquiredAt] = current || [];
    const isFree = !currentToken || (acquiredAt && Date.now() - new Date(acquiredAt).getTime() > LOCK_STALE_MS);

    if (isFree) {
      await writeRange(spreadsheetId, TAB_LOCK, "A2:B2", [[token, new Date().toISOString()]]);
      const [confirm] = await readRange(spreadsheetId, TAB_LOCK, "A2:B2");
      if (confirm && confirm[0] === token) {
        try {
          return await fn();
        } finally {
          const [stillOurs] = await readRange(spreadsheetId, TAB_LOCK, "A2:B2");
          if (stillOurs && stillOurs[0] === token) {
            await writeRange(spreadsheetId, TAB_LOCK, "A2:B2", [["", ""]]);
          }
        }
      }
    }

    await sleep(RETRY_BASE_MS + Math.random() * 300);
  }

  throw new Error("Server busy, please retry");
}
