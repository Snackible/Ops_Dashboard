import { useEffect, useState } from "react";
import { dataClient } from "../../lib/data";
import { useAuth } from "../../lib/auth/AuthContext";
import { notificationStore } from "../../lib/integrations/notificationStore";
import { SkeletonRow } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import type { InventoryItem, StockRequest } from "../../lib/types";

export function CommittedOrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<StockRequest[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  async function refresh() {
    if (!user?.accountId) return;
    const [committed, inv] = await Promise.all([
      dataClient.getCommittedOrders(user.accountId),
      dataClient.getInventory(),
    ]);
    setOrders(committed.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setInventory(inv);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.accountId]);

  const bySku = new Map(inventory.map((i) => [i.skuId, i]));

  function reportError(title: string, err: unknown) {
    notificationStore.push({
      kind: "danger",
      title,
      body: err instanceof Error ? err.message : "Something went wrong.",
    });
  }

  async function push(requestId: string) {
    setPushingId(requestId);
    try {
      await dataClient.pushOrder(requestId);
      notificationStore.push({ kind: "success", title: "Order pushed", body: "Sent to Ops for review." });
      await refresh();
    } catch (err) {
      reportError("Couldn't push order", err);
    } finally {
      setPushingId(null);
    }
  }

  async function cancel(requestId: string) {
    if (!confirm("Cancel this committed order? Reserved stock will be released.")) return;
    setCancelingId(requestId);
    try {
      await dataClient.cancelOrder(requestId);
      notificationStore.push({ kind: "success", title: "Order cancelled", body: "Reserved stock was released." });
      await refresh();
    } catch (err) {
      reportError("Couldn't cancel order", err);
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Committed</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Reserved from stock, not yet sent to Ops. Push each order whenever you're ready.
      </p>

      {loading && (
        <div className="space-y-4">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && orders.length === 0 && (
        <EmptyState title="Nothing committed yet" body="Build an order from New Order, then commit it to see it here." />
      )}

      <div className="space-y-4">
        {orders.map((order) => {
          const total = order.lineItems.reduce((sum, li) => sum + li.qty * li.unitMrpSnapshot, 0);
          const busy = pushingId === order.requestId;
          const canceling = cancelingId === order.requestId;
          return (
            <div key={order.requestId} className="rounded-xl border border-line bg-paper-raised p-5 transition-shadow hover:shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[11px] text-ink-faint">{order.requestId}</p>
                  <p className="text-[12.5px] text-ink-soft">Committed {new Date(order.createdAt).toLocaleString()}</p>
                </div>
                <p className="font-mono text-sm tabular-nums text-ink-soft">₹{total}</p>
              </div>

              <div className="divide-y divide-line">
                {order.lineItems.map((li) => (
                  <div key={li.lineItemId} className="flex items-center justify-between py-2 text-sm">
                    <span>{bySku.get(li.skuId)?.productName ?? li.skuId}</span>
                    <span className="font-mono tabular-nums text-ink-soft">× {li.qty}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => cancel(order.requestId)}
                  disabled={busy || canceling}
                  className="rounded-md border border-line px-4 py-1.5 text-sm font-medium text-ink-soft transition-all hover:bg-paper active:scale-[0.97] disabled:opacity-60"
                >
                  {canceling ? "Cancelling…" : "Cancel"}
                </button>
                <button
                  onClick={() => push(order.requestId)}
                  disabled={busy || canceling}
                  className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
                >
                  {busy ? "Pushing…" : "Push now"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
