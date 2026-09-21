import { useEffect, useState } from "react";
import { dataClient } from "../../lib/data";
import { useAuth } from "../../lib/auth/AuthContext";
import { eventBus } from "../../lib/events";
import { StatusPill } from "../../components/StatusPill";
import { SkeletonRow } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { RefreshButton } from "../../components/RefreshButton";
import type { InventoryItem, ProductRequest, ProductRequestStatus, StockRequest } from "../../lib/types";

const PRODUCT_REQUEST_STATUS_CONFIG: Record<ProductRequestStatus, { label: string; classes: string }> = {
  pending: { label: "Pending", classes: "bg-warning-soft text-warning" },
  accepted: { label: "Accepted", classes: "bg-success-soft text-success" },
  declined: { label: "Declined", classes: "bg-danger-soft text-danger" },
  on_hold: { label: "On hold", classes: "bg-accent-soft text-accent-ink" },
};

export function MyRequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [productRequests, setProductRequests] = useState<ProductRequest[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // No polling of our own here - the global sheets poller (sheetsPolling.ts)
  // already fetches both requests and product requests on its own intervals,
  // so re-polling independently would just double the read cost. Instead we
  // react to the events that poller (or the mock client, synchronously)
  // emits on transitions this account cares about, plus a manual refresh.
  async function refresh() {
    if (!user?.accountId) return;
    const [reqs, preqs] = await Promise.all([
      dataClient.getRequestsForAccount(user.accountId),
      dataClient.getProductRequestsForAccount(user.accountId),
    ]);
    setRequests(
      reqs
        .filter((r) => r.status !== "committed")
        .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    );
    setProductRequests(preqs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLoading(false);
  }

  useEffect(() => {
    if (!user?.accountId) return;
    dataClient.getInventory().then(setInventory);
    refresh();
    const unsubs = [
      eventBus.on("RequestApproved", refresh),
      eventBus.on("RequestDeclined", refresh),
      eventBus.on("ProductRequestDecided", refresh),
    ];
    return () => unsubs.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.accountId]);

  const bySku = new Map(inventory.map((i) => [i.skuId, i]));

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">My Requests</h1>
        <RefreshButton onRefresh={refresh} />
      </div>
      <p className="mb-6 text-sm text-ink-soft">Orders you've pushed to Ops. Build one from New Order, push from Committed.</p>

      {loading && (
        <div className="space-y-4">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && requests.length === 0 && (
        <EmptyState title="No pushed orders yet" body="Commit some items on the Catalog page, then push to Ops." />
      )}

      <div className="space-y-4">
        {requests.map((req) => {
          const total = req.lineItems.reduce((sum, li) => sum + li.qty * li.unitMrpSnapshot, 0);
          return (
            <div
              key={req.requestId}
              className="rounded-xl border border-line bg-paper-raised p-5 transition-shadow hover:shadow-card"
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[11px] text-ink-faint">{req.requestId}</p>
                  <p className="text-[12.5px] text-ink-soft">
                    Pushed {req.submittedAt ? new Date(req.submittedAt).toLocaleString() : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm tabular-nums text-ink-soft">₹{total}</span>
                  <StatusPill status={req.status} />
                </div>
              </div>

              <div className="divide-y divide-line">
                {req.lineItems.map((li) => (
                  <div key={li.lineItemId} className="flex items-center justify-between py-2 text-sm">
                    <span>{bySku.get(li.skuId)?.productName ?? li.skuId}</span>
                    <span className="font-mono tabular-nums text-ink-soft">× {li.qty}</span>
                  </div>
                ))}
              </div>

              {req.decisionNote && (
                <p className="mt-3 rounded-md bg-paper px-3 py-2 text-[13px] text-ink-soft">
                  Note from Ops: {req.decisionNote}
                </p>
              )}
              {req.status === "declined" && !req.decisionNote && (
                <p className="mt-3 rounded-md bg-paper px-3 py-2 text-[13px] text-ink-soft">
                  Declined — reserved stock has been released back to the catalog.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {!loading && productRequests.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold">Product requests</h2>
          <p className="mb-3 text-sm text-ink-soft">Items you asked for that weren't in stock at the time.</p>
          <div className="space-y-2">
            {productRequests.map((r) => {
              const item = bySku.get(r.skuId);
              const c = PRODUCT_REQUEST_STATUS_CONFIG[r.status];
              return (
                <div key={r.requestId} className="rounded-md border border-line bg-paper-raised px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{item?.productName ?? r.skuId}</p>
                      <p className="font-mono text-[10.5px] text-ink-faint">
                        × {r.qty} · {new Date(r.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 font-mono text-[11px] font-medium ${c.classes}`}>
                      {c.label}
                    </span>
                  </div>
                  {r.status === "on_hold" && r.holdUntil && (
                    <p className="mt-1.5 text-[12.5px] text-ink-soft">On hold until {new Date(r.holdUntil).toLocaleDateString()}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
