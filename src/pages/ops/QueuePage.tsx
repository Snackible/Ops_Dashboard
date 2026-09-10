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
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);

  const orderTotal = request.lineItems.reduce((sum, li) => sum + li.qty * li.unitMrpSnapshot, 0);

  async function decide(approve: boolean) {
    if (!user) return;
    if (!approve && note.trim() === "") return;
    setBusy(approve ? "approve" : "decline");
    try {
      await dataClient.decideRequest(request.requestId, user.name, approve, note || null);
      onDecided();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-5 transition-shadow hover:shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold">{account?.companyName ?? "Unknown account"}</p>
          <p className="font-mono text-[11px] text-ink-faint">
            {request.requestId} · pushed {request.submittedAt ? new Date(request.submittedAt).toLocaleString() : ""}
          </p>
        </div>
        <p className="font-mono text-sm tabular-nums text-ink-soft">₹{orderTotal}</p>
      </div>

      <div className="divide-y divide-line">
        {request.lineItems.map((li) => {
          const item = inventory.get(li.skuId);
          return (
            <div key={li.lineItemId} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span>{item?.productName ?? li.skuId}</span>
              <span className="font-mono tabular-nums text-ink-soft">{li.qty} committed</span>
            </div>
          );
        })}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (required to decline, optional to approve)"
        rows={2}
        className="mt-3 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
      />

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => decide(false)}
          disabled={busy !== null || note.trim() === ""}
          title={note.trim() === "" ? "Add a note to decline" : undefined}
          className="rounded-md border border-danger px-3 py-1.5 text-[13px] text-danger transition-all hover:bg-danger-soft active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
        >
          {busy === "decline" ? "Declining…" : "Decline"}
        </button>
        <button
          onClick={() => decide(true)}
          disabled={busy !== null}
          className="ml-auto rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-60 disabled:active:scale-100"
        >
          {busy === "approve" ? "Approving…" : "Approve"}
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
    () => requests.filter((r) => r.status === "pending").sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "")),
    [requests]
  );
  const accountsById = new Map(accounts.map((a) => [a.accountId, a]));
  const inventoryBySku = new Map(inventory.map((i) => [i.skuId, i]));

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Requests queue</h1>
      <p className="mb-6 text-sm text-ink-soft">
        {pending.length} pushed order{pending.length === 1 ? "" : "s"} awaiting a decision — stock is already
        reserved; declining releases it back.
      </p>

      {loading && (
        <div className="space-y-4">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && pending.length === 0 && (
        <EmptyState title="Nothing waiting on you" body="A pushed order will pop up here the moment it lands." />
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
