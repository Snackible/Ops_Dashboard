import { useEffect, useMemo, useState } from "react";
import { dataClient } from "../../lib/data";
import { useAuth } from "../../lib/auth/AuthContext";
import { notificationStore } from "../../lib/integrations/notificationStore";
import { SkeletonRow } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import type { B2BAccount, InventoryItem, StockRequest } from "../../lib/types";

function RequestCard({
  request,
  account,
  inventory,
  onDecided,
}: {
  request: StockRequest;
  account: B2BAccount | undefined;
  inventory: Map<string, InventoryItem>;
  onDecided: () => void;
}) {
  const { user } = useAuth();
  const [qtys, setQtys] = useState<Record<string, number>>(() =>
    Object.fromEntries(request.lineItems.map((li) => [li.lineItemId, li.qtyRequested]))
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide() {
    if (!user) return;
    setBusy(true);
    try {
      await dataClient.decideRequest(
        request.requestId,
        user.name,
        request.lineItems.map((li) => ({ lineItemId: li.lineItemId, qtyFulfilled: qtys[li.lineItemId] ?? 0 })),
        note || null
      );
      onDecided();
    } finally {
      setBusy(false);
    }
  }

  function declineAll() {
    setQtys(Object.fromEntries(request.lineItems.map((li) => [li.lineItemId, 0])));
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-5 transition-shadow hover:shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold">{account?.companyName ?? "Unknown account"}</p>
          <p className="font-mono text-[11px] text-ink-faint">
            {request.requestId} · {new Date(request.submittedAt).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="divide-y divide-line">
        {request.lineItems.map((li) => {
          const item = inventory.get(li.skuId);
          return (
            <div key={li.lineItemId} className="flex items-center justify-between gap-4 py-2 text-sm">
              <div>
                <p>{item?.productName ?? li.skuId}</p>
                <p className="font-mono text-[11px] text-ink-faint">requested {li.qtyRequested}</p>
              </div>
              <input
                type="number"
                min={0}
                max={li.qtyRequested}
                value={qtys[li.lineItemId]}
                onChange={(e) =>
                  setQtys((prev) => ({
                    ...prev,
                    [li.lineItemId]: Math.max(0, Math.min(li.qtyRequested, Number(e.target.value))),
                  }))
                }
                className="w-20 rounded-md border border-line bg-paper px-2 py-1 text-center text-sm tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label={`Fulfilled quantity for ${item?.productName ?? li.skuId}`}
              />
            </div>
          );
        })}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (required for a decline, optional otherwise)"
        rows={2}
        className="mt-3 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
      />

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={declineAll}
          className="rounded-md border border-danger px-3 py-1.5 text-[13px] text-danger transition-all hover:bg-danger-soft active:scale-[0.97]"
        >
          Decline all
        </button>
        <button
          onClick={decide}
          disabled={busy}
          className="ml-auto rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-60 disabled:active:scale-100"
        >
          {busy ? "Saving…" : "Confirm decision"}
        </button>
      </div>
    </div>
  );
}

export function QueuePage() {
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [accounts, setAccounts] = useState<B2BAccount[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const [reqs, accts, inv] = await Promise.all([
      dataClient.getRequests(),
      dataClient.getAccounts(),
      dataClient.getInventory(),
    ]);
    setRequests(reqs);
    setAccounts(accts);
    setInventory(inv);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, []);

  const pending = useMemo(
    () => requests.filter((r) => r.status === "pending").sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    [requests]
  );
  const accountsById = new Map(accounts.map((a) => [a.accountId, a]));
  const inventoryBySku = new Map(inventory.map((i) => [i.skuId, i]));

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Requests queue</h1>
      <p className="mb-6 text-sm text-ink-soft">
        {pending.length} pending request{pending.length === 1 ? "" : "s"} — decide per item, edit quantity for a
        partial approval.
      </p>

      {loading && (
        <div className="space-y-4">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && pending.length === 0 && (
        <EmptyState title="Nothing waiting on you" body="New requests will pop up here the moment they're submitted." />
      )}

      <div className="space-y-4">
        {pending.map((req) => (
          <RequestCard
            key={req.requestId}
            request={req}
            account={accountsById.get(req.accountId)}
            inventory={inventoryBySku}
            onDecided={() => {
              refresh();
              notificationStore.push({ kind: "success", title: "Decision saved", body: "The B2B account has been notified." });
            }}
          />
        ))}
      </div>
    </div>
  );
}
