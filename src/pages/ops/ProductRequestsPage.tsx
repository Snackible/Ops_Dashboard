import { useMemo, useState } from "react";
import { dataClient } from "../../lib/data";
import { liveStore, useLiveStore } from "../../lib/data/liveStore";
import { useAuth } from "../../lib/auth/AuthContext";
import { notificationStore } from "../../lib/integrations/notificationStore";
import { LoadingState } from "../../components/Spinner";
import { EmptyState } from "../../components/EmptyState";
import { RefreshButton } from "../../components/RefreshButton";
import type { B2BAccount, InventoryItem, ProductRequest, ProductRequestStatus } from "../../lib/types";

const DECIDED_CONFIG: Record<Exclude<ProductRequestStatus, "pending">, { label: string; classes: string }> = {
  accepted: { label: "Accepted", classes: "bg-success-soft text-success" },
  declined: { label: "Declined", classes: "bg-danger-soft text-danger" },
  on_hold: { label: "On hold", classes: "bg-accent-soft text-accent-ink" },
};

interface SkuGroup {
  skuId: string;
  item: InventoryItem | undefined;
  totalQty: number;
  requests: ProductRequest[];
}

function GroupCard({
  group,
  accountsById,
  onDecided,
}: {
  group: SkuGroup;
  accountsById: Map<string, B2BAccount>;
  onDecided: () => void;
}) {
  const { user } = useAuth();
  const [holdUntil, setHoldUntil] = useState("");
  const [busy, setBusy] = useState<ProductRequestStatus | null>(null);

  async function decide(status: Exclude<ProductRequestStatus, "pending">) {
    if (!user) return;
    if (status === "on_hold" && !holdUntil) return;
    setBusy(status);
    try {
      await dataClient.decideProductRequests(group.skuId, user.name, status, status === "on_hold" ? holdUntil : null);
      onDecided();
    } catch (err) {
      notificationStore.push({
        kind: "danger",
        title: "Couldn't save decision",
        body: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-5 transition-shadow hover:shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold">{group.item?.productName ?? group.skuId}</p>
          <p className="font-mono text-[11px] text-ink-faint">
            {group.item?.category} · avail {group.item?.currentStock ?? 0}
          </p>
        </div>
        <p className="font-mono text-lg font-semibold tabular-nums">{group.totalQty} requested</p>
      </div>

      <div className="divide-y divide-line">
        {group.requests.map((r) => (
          <div key={r.requestId} className="py-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span>{accountsById.get(r.accountId)?.companyName ?? r.accountId}</span>
              <span className="font-mono tabular-nums text-ink-soft">× {r.qty}</span>
            </div>
            {r.note && <p className="mt-0.5 text-[12px] text-ink-faint">"{r.note}"</p>}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={holdUntil}
          onChange={(e) => setHoldUntil(e.target.value)}
          className="rounded-md border border-line bg-paper px-2 py-1.5 text-[13px] transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={() => decide("on_hold")}
          disabled={busy !== null || !holdUntil}
          title={!holdUntil ? "Pick a date to hold until" : undefined}
          className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-all hover:text-ink active:scale-[0.97] disabled:opacity-40"
        >
          {busy === "on_hold" ? "Holding…" : "Hold"}
        </button>
        <button
          onClick={() => decide("declined")}
          disabled={busy !== null}
          className="rounded-md border border-danger px-3 py-1.5 text-[13px] text-danger transition-all hover:bg-danger-soft active:scale-[0.97] disabled:opacity-40"
        >
          {busy === "declined" ? "Declining…" : "Decline"}
        </button>
        <button
          onClick={() => decide("accepted")}
          disabled={busy !== null}
          className="ml-auto rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
        >
          {busy === "accepted" ? "Accepting…" : "Accept"}
        </button>
      </div>
    </div>
  );
}

export function ProductRequestsPage() {
  // Reads shared state instead of fetching its own copy on mount - see
  // liveStore.ts. The background poller keeps `productRequests` current
  // (on its slower cadence); a manual refresh or a decision made right here
  // is what updates it otherwise. Navigating to/from this page never fires
  // a network call on its own.
  const { productRequests: requests, accounts, inventory, productRequestsReady, accountsReady, inventoryReady } = useLiveStore();
  const loading = !productRequestsReady || !accountsReady || !inventoryReady;

  const accountsById = new Map(accounts.map((a) => [a.accountId, a]));
  const inventoryBySku = new Map(inventory.map((i) => [i.skuId, i]));

  const groups = useMemo(() => {
    const bySku = new Map<string, ProductRequest[]>();
    for (const r of requests) {
      if (r.status !== "pending") continue;
      const list = bySku.get(r.skuId) ?? [];
      list.push(r);
      bySku.set(r.skuId, list);
    }
    const result: SkuGroup[] = [];
    bySku.forEach((reqs, skuId) => {
      result.push({
        skuId,
        item: inventoryBySku.get(skuId),
        totalQty: reqs.reduce((sum, r) => sum + r.qty, 0),
        requests: reqs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      });
    });
    return result.sort((a, b) => b.totalQty - a.totalQty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, inventory]);

  const decided = requests
    .filter((r) => r.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">Product Requests</h1>
        <RefreshButton onRefresh={liveStore.refreshAll} />
      </div>
      <p className="mb-6 text-sm text-ink-soft">
        {loading
          ? "Loading…"
          : `${groups.length} product${groups.length === 1 ? "" : "s"} requested — matching requests from different accounts are combined below.`}
      </p>

      {loading ? (
        <LoadingState label="Loading product requests…" />
      ) : (
        <>
          {groups.length === 0 && (
            <EmptyState title="Nothing requested" body="A product request will show up here the moment B2B sends one." />
          )}
          <div className="space-y-4">
            {groups.map((g) => (
              <GroupCard key={g.skuId} group={g} accountsById={accountsById} onDecided={liveStore.refreshProductRequests} />
            ))}
          </div>

          {decided.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-3 font-display text-lg font-semibold">Decided</h2>
              <div className="space-y-2">
                {decided.map((r) => {
                  const c = DECIDED_CONFIG[r.status as Exclude<ProductRequestStatus, "pending">];
                  return (
                    <div key={r.requestId} className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper-raised px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px]">
                          {inventoryBySku.get(r.skuId)?.productName ?? r.skuId} × {r.qty} —{" "}
                          {accountsById.get(r.accountId)?.companyName ?? r.accountId}
                        </p>
                        {r.status === "on_hold" && r.holdUntil && (
                          <p className="font-mono text-[10.5px] text-ink-faint">
                            until {new Date(r.holdUntil).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 font-mono text-[11px] font-medium ${c.classes}`}>
                        {c.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
