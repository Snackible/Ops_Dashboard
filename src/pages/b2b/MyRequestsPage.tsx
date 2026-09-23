import { useMemo } from "react";
import { liveStore, useLiveStore } from "../../lib/data/liveStore";
import { useAuth } from "../../lib/auth/AuthContext";
import { StatusPill } from "../../components/StatusPill";
import { SkeletonRow } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { RefreshButton } from "../../components/RefreshButton";
import type { ProductRequestStatus } from "../../lib/types";

const PRODUCT_REQUEST_STATUS_CONFIG: Record<ProductRequestStatus, { label: string; classes: string }> = {
  pending: { label: "Pending", classes: "bg-warning-soft text-warning" },
  accepted: { label: "Accepted", classes: "bg-success-soft text-success" },
  declined: { label: "Declined", classes: "bg-danger-soft text-danger" },
  on_hold: { label: "On hold", classes: "bg-accent-soft text-accent-ink" },
};

export function MyRequestsPage() {
  const { user } = useAuth();
  // Reads shared state instead of fetching its own copy on mount - see
  // liveStore.ts. `requests`/`productRequests` are the full ops-wide lists
  // (the background poller already fetches all of it into every tab to
  // detect status changes), filtered down to this account's own.
  const { requests: allRequests, productRequests: allProductRequests, inventory, requestsReady, productRequestsReady, inventoryReady } = useLiveStore();
  const loading = !requestsReady || !productRequestsReady || !inventoryReady;

  const requests = useMemo(
    () =>
      allRequests
        .filter((r) => r.accountId === user?.accountId && r.status !== "committed")
        .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")),
    [allRequests, user?.accountId]
  );
  const productRequests = useMemo(
    () =>
      allProductRequests
        .filter((r) => r.accountId === user?.accountId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allProductRequests, user?.accountId]
  );

  const bySku = new Map(inventory.map((i) => [i.skuId, i]));

  function refresh() {
    return Promise.all([liveStore.refreshRequests(), liveStore.refreshProductRequests()]);
  }

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
                  <p className="font-mono text-[11px] text-ink-faint">
                    {req.requestId}
                    {req.requestedByName && <span className="text-ink-soft"> · {req.requestedByName}</span>}
                  </p>
                  {req.clientName && <p className="text-[12.5px] font-medium">For {req.clientName}</p>}
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
                    <span className="font-mono tabular-nums text-ink-soft">
                      × {li.qty}
                      {li.backorderQty > 0 && <span className="text-warning"> ({li.backorderQty} pending production)</span>}
                    </span>
                  </div>
                ))}
              </div>

              {(req.status === "approved" || req.status === "declined") && req.decidedBy && (
                <p className="mt-3 text-[12px] text-ink-faint">
                  {req.status === "approved" ? "Approved" : "Declined"} by {req.decidedBy}
                  {req.decidedAt && ` · ${new Date(req.decidedAt).toLocaleString()}`}
                </p>
              )}
              {req.decisionNote && (
                <p className="mt-1.5 rounded-md bg-paper px-3 py-2 text-[13px] text-ink-soft">
                  Note from Ops: {req.decisionNote}
                </p>
              )}
              {req.status === "declined" && !req.decisionNote && (
                <p className="mt-1.5 rounded-md bg-paper px-3 py-2 text-[13px] text-ink-soft">
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
                        {r.linkedRequestId && ` · part of ${r.linkedRequestId}`}
                      </p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 font-mono text-[11px] font-medium ${c.classes}`}>
                      {c.label}
                    </span>
                  </div>
                  {r.status === "on_hold" && r.holdUntil && (
                    <p className="mt-1.5 text-[12.5px] text-ink-soft">On hold until {new Date(r.holdUntil).toLocaleDateString()}</p>
                  )}
                  {r.status === "accepted" && r.holdUntil && (
                    <p className="mt-1.5 text-[12.5px] text-ink-soft">Expected by {new Date(r.holdUntil).toLocaleDateString()}</p>
                  )}
                  {r.status !== "pending" && r.decidedBy && (
                    <p className="mt-1.5 text-[12px] text-ink-faint">
                      {c.label} by {r.decidedBy}
                    </p>
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
