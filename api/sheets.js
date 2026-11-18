import {
  login,
  createUser,
  getResetRequests,
  resetPassword,
  secureLogins,
  getInventory,
  getAccounts,
  getRequests,
  getFulfillmentLog,
  getProductRequests,
  setInventoryField,
  updateInventoryFields,
  commitOrder,
  pushOrder,
  cancelOrder,
  decideRequest,
  requestProduct,
  decideProductRequests,
  addTierRowHighlighting,
  removeTierRowHighlighting,
  withLock,
} from "../server/actions.js";

// Repeated wrong master passwords from one address are cut off for a while.
// Best effort only (per warm serverless instance), which still stops a quick
// guessing run against the master code on the two actions that accept it.
const MASTER_MAX_FAILS = 6;
const MASTER_WINDOW_MS = 15 * 60 * 1000;
const masterFails = new Map();

function clientKey(req, action) {
  const forwarded = String((req.headers && req.headers["x-forwarded-for"]) || "").split(",")[0].trim();
  return action + "|" + (forwarded || (req.socket && req.socket.remoteAddress) || "unknown");
}

function masterLimited(key) {
  const rec = masterFails.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > MASTER_WINDOW_MS) {
    masterFails.delete(key);
    return false;
  }
  return rec.count >= MASTER_MAX_FAILS;
}

/** Runs a master-password-gated action with the rate limit around it. */
async function withMasterLimit(req, action, run) {
  const key = clientKey(req, action);
  if (masterLimited(key)) throw new Error("Too many attempts. Try again in a few minutes.");
  try {
    const result = await run();
    masterFails.delete(key);
    return result;
  } catch (err) {
    if (err && err.message === "Incorrect master password") {
      const rec = masterFails.get(key);
      masterFails.set(key, rec ? { ...rec, count: rec.count + 1 } : { first: Date.now(), count: 1 });
    }
    throw err;
  }
}

/**
 * Same one-endpoint, action-in-body dispatch shape as the old Apps Script
 * route_() switch, so the migration is a transport swap, not a rewrite of
 * the frontend. Same-origin now (this runs on the same Vercel deployment
 * as the app), so there's no CORS dance and no reason to expose an API
 * token to the browser - if you want one anyway, set API_TOKEN and send it
 * from a server-only context.
 */
export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const body = req.method === "GET" ? req.query : req.body || {};

  const expectedToken = process.env.API_TOKEN;
  if (expectedToken && body.token !== expectedToken) {
    res.status(200).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const ratecardId = process.env.RATECARD_SPREADSHEET_ID;
  // OPERATIONAL_SPREADSHEET_ID now points at the dedicated logins-only
  // spreadsheet (renamed from its old role) - Accounts/Orders/OrderLines/
  // FulfillmentLog/ProductRequests/Lock all moved onto the ratecard
  // spreadsheet, so only Users is looked up here.
  const loginId = process.env.OPERATIONAL_SPREADSHEET_ID;
  if (!ratecardId || !loginId) {
    res.status(200).json({ ok: false, error: "RATECARD_SPREADSHEET_ID / OPERATIONAL_SPREADSHEET_ID not configured" });
    return;
  }
  const opsId = ratecardId;

  try {
    let data;
    switch (body.action) {
      // reads
      case "login": data = await login(loginId, opsId, body.username, body.password); break;
      case "secureLogins": data = await secureLogins(loginId); break;
      case "createUser": data = await withMasterLimit(req, "createUser", () => withLock(opsId, () => createUser(loginId, body.username, body.password, body.role, body.masterPassword))); break;
      case "getResetRequests": data = await getResetRequests(loginId); break;
      case "resetPassword": data = await withMasterLimit(req, "resetPassword", () => withLock(opsId, () => resetPassword(loginId, body.username, body.password, body.masterPassword))); break;
      case "getInventory": data = await getInventory(ratecardId); break;
      case "getAccounts": data = await getAccounts(opsId); break;
      case "getRequests": data = await getRequests(opsId, null); break;
      case "getRequestsForAccount": data = await getRequests(opsId, body.accountId); break;
      case "getCommittedOrders": data = (await getRequests(opsId, body.accountId)).filter((r) => r.status === "committed"); break;
      case "getFulfillmentLog": data = await getFulfillmentLog(opsId); break;
      case "getProductRequests": data = await getProductRequests(opsId, null); break;
      case "getProductRequestsForAccount": data = await getProductRequests(opsId, body.accountId); break;

      // writes
      case "updateStock": data = await withLock(opsId, () => setInventoryField(ratecardId, body.skuId, "current_stock", body.currentStock)); break;
      case "setActive": data = await withLock(opsId, () => setInventoryField(ratecardId, body.skuId, "active", body.active)); break;
      case "setTier": data = await withLock(opsId, () => setInventoryField(ratecardId, body.skuId, "tier", body.tier)); break;
      case "updateInventoryFields": data = await withLock(opsId, () => updateInventoryFields(ratecardId, body.updates)); break;
      case "commitOrder": data = await withLock(opsId, () => commitOrder(ratecardId, opsId, body.accountId, body.lineItems, body.requestedByName, body.clientName)); break;
      case "pushOrder": data = await withLock(opsId, () => pushOrder(opsId, body.requestId)); break;
      case "cancelOrder": data = await withLock(opsId, () => cancelOrder(ratecardId, opsId, body.requestId)); break;
      case "decideRequest": data = await withLock(opsId, () => decideRequest(ratecardId, opsId, body.requestId, body.decidedBy, body.approve, body.decisionNote)); break;
      case "requestProduct": data = await withLock(opsId, () => requestProduct(ratecardId, opsId, body.accountId, body.skuId, body.qty, body.note)); break;
      case "decideProductRequests": data = await withLock(opsId, () => decideProductRequests(opsId, body.skuId, body.decidedBy, body.status, body.holdUntil)); break;

      // one-time admin setup - not called by the UI. Accepts an optional
      // spreadsheetId override so it can be dry-run against a scratch copy
      // before ever touching the real ratecard.
      case "addTierRowHighlighting": data = await addTierRowHighlighting(body.spreadsheetId || ratecardId); break;
      case "removeTierRowHighlighting": data = await removeTierRowHighlighting(body.spreadsheetId || ratecardId); break;

      default:
        res.status(200).json({ ok: false, error: "Unknown action: " + body.action });
        return;
    }
    res.status(200).json({ ok: true, data });
  } catch (err) {
    res.status(200).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}
