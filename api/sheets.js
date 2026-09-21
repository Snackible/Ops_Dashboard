import {
  getInventory,
  getAccounts,
  getRequests,
  getFulfillmentLog,
  getProductRequests,
  setInventoryField,
  commitOrder,
  pushOrder,
  cancelOrder,
  decideRequest,
  requestProduct,
  decideProductRequests,
  withLock,
} from "../server/actions.js";

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
  const opsId = process.env.OPERATIONAL_SPREADSHEET_ID;
  if (!ratecardId || !opsId) {
    res.status(200).json({ ok: false, error: "RATECARD_SPREADSHEET_ID / OPERATIONAL_SPREADSHEET_ID not configured" });
    return;
  }

  try {
    let data;
    switch (body.action) {
      // reads
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
      case "commitOrder": data = await withLock(opsId, () => commitOrder(ratecardId, opsId, body.accountId, body.lineItems)); break;
      case "pushOrder": data = await withLock(opsId, () => pushOrder(opsId, body.requestId)); break;
      case "cancelOrder": data = await withLock(opsId, () => cancelOrder(ratecardId, opsId, body.requestId)); break;
      case "decideRequest": data = await withLock(opsId, () => decideRequest(ratecardId, opsId, body.requestId, body.decidedBy, body.approve, body.decisionNote)); break;
      case "requestProduct": data = await withLock(opsId, () => requestProduct(ratecardId, opsId, body.accountId, body.skuId, body.qty, body.note)); break;
      case "decideProductRequests": data = await withLock(opsId, () => decideProductRequests(opsId, body.skuId, body.decidedBy, body.status, body.holdUntil)); break;

      default:
        res.status(200).json({ ok: false, error: "Unknown action: " + body.action });
        return;
    }
    res.status(200).json({ ok: true, data });
  } catch (err) {
    res.status(200).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}
