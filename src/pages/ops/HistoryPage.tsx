import { useEffect, useMemo, useState } from "react";
import { liveStore, useLiveStore } from "../../lib/data/liveStore";
import { StatusPill } from "../../components/StatusPill";
import { EmptyState } from "../../components/EmptyState";
import { SkeletonRow } from "../../components/Skeleton";
import { RefreshButton } from "../../components/RefreshButton";

export function HistoryPage() {
  // Accounts/inventory/requests read shared state - see liveStore.ts. The
  // fulfillment sheet is the one thing fetched here specifically, lazily on
  // first visit only (guarded by fulfillmentLogReady) since History is a
  // rarely-visited page and there's no reason to load it for everyone at
  // boot the way the more commonly-needed data is.
  const {
    requests: allRequests,
    accounts,
    inventory,
    fulfillmentLog: sheetRows,
    requestsReady,
    accountsReady,
    inventoryReady,
    fulfillmentLogReady,
  } = useLiveStore();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"requests" | "sheet">("requests");
  const loading = !requestsReady || !accountsReady || !inventoryReady || !fulfillmentLogReady;

  useEffect(() => {
    if (!fulfillmentLogReady) liveStore.refreshFulfillmentLog();
  }, [fulfillmentLogReady]);

  const requests = useMemo(
    () => allRequests.filter((r) => r.status === "approved" || r.status === "declined"),
    [allRequests]
  );
  const accountsById = new Map(accounts.map((a) => [a.accountId, a]));
  const inventoryBySku = new Map(inventory.map((i) => [i.skuId, i]));

  const filteredRequests = useMemo(() => {
    const q = query.toLowerCase();
    return requests.filter((r) => (accountsById.get(r.accountId)?.companyName ?? "").toLowerCase().includes(q));
  }, [requests, query, accountsById]);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">History</h1>
        <RefreshButton onRefresh={() => Promise.all([liveStore.refreshRequests(), liveStore.refreshFulfillmentLog()])} />
      </div>
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
                    {inventoryBySku.get(li.skuId)?.productName ?? li.skuId} × {li.qty}
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
                <th className="px-3 py-2">Qty</th>
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
                  <td className="px-3 py-2 font-mono tabular-nums">{row.qty}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">₹{row.lineTotal}</td>
                  <td className="px-3 py-2">{row.approvedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sheetRows.length === 0 && (
            <div className="p-6">
              <EmptyState title="No rows yet" body="This fills in as Ops approves requests." />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
