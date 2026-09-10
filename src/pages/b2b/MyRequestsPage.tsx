import { useEffect, useState } from "react";
import { dataClient } from "../../lib/data";
import { useAuth } from "../../lib/auth/AuthContext";
import { StatusPill } from "../../components/StatusPill";
import { SkeletonRow } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import type { InventoryItem, StockRequest } from "../../lib/types";

export function MyRequestsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!user?.accountId) return;
    const [reqs, inv] = await Promise.all([
      dataClient.getRequestsForAccount(user.accountId),
      dataClient.getInventory(),
    ]);
    setRequests(
      reqs
        .filter((r) => r.status !== "draft")
        .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    );
    setInventory(inv);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.accountId]);

  const bySku = new Map(inventory.map((i) => [i.skuId, i]));

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">My Requests</h1>
      <p className="mb-6 text-sm text-ink-soft">Orders you've pushed to Ops. Build or edit a draft from the Catalog.</p>

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
    </div>
  );
}
