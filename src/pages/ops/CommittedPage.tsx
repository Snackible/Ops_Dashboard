import { useMemo } from "react";
import { liveStore, useLiveStore } from "../../lib/data/liveStore";
import { EmptyState } from "../../components/EmptyState";
import { SkeletonRow } from "../../components/Skeleton";
import { RefreshButton } from "../../components/RefreshButton";

/**
 * Read-only visibility into orders B2B has reserved from stock but not yet
 * pushed - nothing here needs (or allows) a decision from Ops, it's purely
 * "here's what's sitting in someone's cart right now." A committed order
 * leaves this list the moment it's pushed (it becomes "pending", showing up
 * in Queue instead) or cancelled (it's removed outright).
 */
export function CommittedPage() {
  const { requests: allRequests, accounts, inventory, requestsReady, accountsReady, inventoryReady } = useLiveStore();
  const loading = !requestsReady || !accountsReady || !inventoryReady;

  const committed = useMemo(
    () =>
      allRequests
        .filter((r) => r.status === "committed")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allRequests]
  );

  const accountsById = new Map(accounts.map((a) => [a.accountId, a]));
  const inventoryBySku = new Map(inventory.map((i) => [i.skuId, i]));

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">Committed</h1>
        <RefreshButton onRefresh={liveStore.refreshRequests} />
      </div>
      <p className="mb-6 text-sm text-ink-soft">
        Reserved from stock, not pushed yet - nothing to do here, it's just visibility until B2B pushes or cancels.
      </p>

      {loading && (
        <div className="space-y-4">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && committed.length === 0 && (
        <EmptyState title="Nothing committed right now" body="Orders B2B has reserved but not pushed will show up here." />
      )}

      <div className="space-y-4">
        {committed.map((order) => {
          const total = order.lineItems.reduce((sum, li) => sum + li.qty * li.unitMrpSnapshot, 0);
          return (
            <div key={order.requestId} className="rounded-xl border border-line bg-paper-raised p-5 opacity-90 transition-shadow hover:shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold">
                    {accountsById.get(order.accountId)?.companyName ?? "Unknown account"}
                    {order.requestedByName && <span className="font-normal text-ink-soft"> — {order.requestedByName}</span>}
                  </p>
                  {order.clientName && <p className="text-[12.5px] text-ink-soft">For {order.clientName}</p>}
                  <p className="font-mono text-[11px] text-ink-faint">
                    {order.requestId} · committed {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>
                <p className="font-mono text-sm tabular-nums text-ink-soft">₹{total}</p>
              </div>

              <div className="divide-y divide-line">
                {order.lineItems.map((li) => (
                  <div key={li.lineItemId} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <span>{inventoryBySku.get(li.skuId)?.productName ?? li.skuId}</span>
                    <span className="font-mono tabular-nums text-ink-soft">
                      {li.qty}
                      {li.backorderQty > 0 && <span className="text-warning"> ({li.backorderQty} pending production)</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
