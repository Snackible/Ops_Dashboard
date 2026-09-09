import { useEffect, useMemo, useState } from "react";
import { dataClient } from "../../lib/data";
import { readFulfillmentLog } from "../../lib/integrations/fulfillmentSheetLog";
import { StatusPill } from "../../components/StatusPill";
import { EmptyState } from "../../components/EmptyState";
import { SkeletonRow } from "../../components/Skeleton";
import type { B2BAccount, FulfillmentLogRow, InventoryItem, StockRequest } from "../../lib/types";

export function HistoryPage() {
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [accounts, setAccounts] = useState<B2BAccount[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sheetRows, setSheetRows] = useState<FulfillmentLogRow[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"requests" | "sheet">("requests");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([dataClient.getRequests(), dataClient.getAccounts(), dataClient.getInventory()]).then(
      ([reqs, accts, inv]) => {
        setRequests(reqs.filter((r) => r.status !== "pending"));
        setAccounts(accts);
        setInventory(inv);
        setLoading(false);
      }
    );
    setSheetRows(readFulfillmentLog());
  }, []);

  const accountsById = new Map(accounts.map((a) => [a.accountId, a]));
  const inventoryBySku = new Map(inventory.map((i) => [i.skuId, i]));

  const filteredRequests = useMemo(() => {
    const q = query.toLowerCase();
    return requests.filter((r) => (accountsById.get(r.accountId)?.companyName ?? "").toLowerCase().includes(q));
  }, [requests, query, accountsById]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">History</h1>
      <p className="mb-6 text-sm text-ink-soft">Every decided request, plus what actually got written to the fulfillment sheet.</p>

      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex rounded-full border border-line bg-paper-raised p-1">
          {(["requests", "sheet"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-[13px] transition-all ${
                tab === t ? "bg-accent text-white font-medium" : "text-ink-soft hover:text-ink"
              }`}
            >
              {t === "requests" ? "Decided requests" : "Fulfillment sheet"}
            </button>
          ))}
        </div>
        {tab === "requests" && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by account…"
            className="w-56 rounded-md border border-line bg-paper-raised px-3 py-2 text-sm placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
          />
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : tab === "requests" ? (
        <div className="space-y-3">
          {filteredRequests.map((req) => (
            <div
              key={req.requestId}
              className="rounded-lg border border-line bg-paper-raised p-4 transition-shadow hover:shadow-card"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{accountsById.get(req.accountId)?.companyName}</p>
                  <p className="font-mono text-[11px] text-ink-faint">
                    {req.requestId} · decided {req.decidedAt ? new Date(req.decidedAt).toLocaleString() : ""} by{" "}
                    {req.decidedBy}
                  </p>
                </div>
                <StatusPill status={req.status} />
              </div>
              <ul className="mt-2 space-y-1 text-[13px] text-ink-soft">
                {req.lineItems.map((li) => (
                  <li key={li.lineItemId} className="font-mono tabular-nums">
                    {inventoryBySku.get(li.skuId)?.productName ?? li.skuId}: {li.qtyRequested} → {li.qtyFulfilled}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {filteredRequests.length === 0 && (
            <EmptyState title="No decided requests yet" body="Approved and declined requests will build up a history here." />
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line bg-paper-raised text-left font-mono text-[10.5px] uppercase tracking-wide text-ink-soft">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Req</th>
                <th className="px-3 py-2">Fulfilled</th>
                <th className="px-3 py-2">Line total</th>
                <th className="px-3 py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {sheetRows.map((row, i) => (
                <tr key={i} className="border-b border-line transition-colors last:border-0 hover:bg-paper-raised">
                  <td className="px-3 py-2 font-mono text-[11.5px]">{new Date(row.dateFulfilled).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{row.companyName}</td>
                  <td className="px-3 py-2">{row.productName}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{row.qtyRequested}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{row.qtyFulfilled}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">₹{row.lineTotal}</td>
                  <td className="px-3 py-2">{row.approvedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sheetRows.length === 0 && (
            <div className="p-6">
              <EmptyState
                title="No rows yet"
                body="This fills in as Ops approves requests (mocked locally until Sheets is wired up)."
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
