import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataClient } from "../../lib/data";
import { liveStore, useLiveStore } from "../../lib/data/liveStore";
import { useAuth } from "../../lib/auth/AuthContext";
import { notificationStore } from "../../lib/integrations/notificationStore";
import { LoadingState } from "../../components/Spinner";
import { EmptyState } from "../../components/EmptyState";
import { RefreshButton } from "../../components/RefreshButton";
import { TIER_CONFIG, TIER_ORDER } from "../../components/TierBadge";
import { isLargerPack } from "../../lib/inventory";
import type { InventoryItem, Tier } from "../../lib/types";

type Stage = "browsing" | "preview";
type TierFilter = "all" | Tier;

function CatalogRow({
  item,
  qty,
  onChange,
}: {
  item: InventoryItem;
  qty: number;
  onChange: (qty: number) => void;
}) {
  const c = TIER_CONFIG[item.tier];
  const overStock = qty > item.currentStock;
  const stockBadge =
    item.currentStock <= 0
      ? { label: "Out of stock", cls: "bg-danger/10 text-danger border-danger/30" }
      : item.currentStock < 10
        ? { label: `${item.currentStock} left`, cls: "bg-warning/10 text-warning border-warning/30" }
        : { label: `${item.currentStock} in stock`, cls: "bg-success/10 text-success border-success/30" };
  return (
    <div className={`flex items-center gap-3 rounded-md border border-l-[3px] border-line bg-paper-raised px-3.5 py-2.5 ${c.borderSolid}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="truncate text-[13.5px] font-medium leading-tight">
            {item.productName}
            {isLargerPack(item.skuId) && <span className="ml-1 font-semibold text-accent-ink" title="Larger Pack">(L)</span>}
          </p>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums ${stockBadge.cls}`}
          >
            {stockBadge.label}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-ink-faint">
          {item.category} · {item.grammageG}g · ₹{item.mrpInr}
        </p>
        {overStock && <p className="mt-0.5 text-[10.5px] text-warning">Not enough in stock — this will be sent to Ops as a request.</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => onChange(qty - 1)}
          disabled={qty <= 0}
          className="h-7 w-7 rounded border border-line text-ink-soft transition-colors hover:border-ink-faint hover:text-ink hover:bg-paper active:scale-95 disabled:opacity-40"
          aria-label={`Decrease quantity for ${item.productName}`}
        >
          −
        </button>
        <input
          type="number"
          min={0}
          value={qty}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`w-14 rounded-md border-2 bg-paper px-1 py-1 text-center font-mono text-[13px] font-bold tabular-nums text-ink transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 ${
            overStock ? "border-warning focus:border-warning" : "border-accent/40 focus:border-accent"
          }`}
        />
        <button
          onClick={() => onChange(qty + 1)}
          className="h-7 w-7 rounded border border-line text-ink-soft transition-colors hover:border-ink-faint hover:text-ink hover:bg-paper active:scale-95 disabled:opacity-40"
          aria-label={`Increase quantity for ${item.productName}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function CatalogPage() {
  // Reads shared state instead of fetching its own copy on mount - see
  // liveStore.ts. Inventory is public catalog data, so it's safe to share
  // the same slice Ops's pages read; only a manual refresh or an order
  // that actually changes stock updates it otherwise.
  const { inventory: items, inventoryReady } = useLiveStore();
  const loading = !inventoryReady;
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [stage, setStage] = useState<Stage>("browsing");
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.category)))], [items]);

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          i.active &&
          (tierFilter === "all" || i.tier === tierFilter) &&
          (category === "All" || i.category === category) &&
          i.productName.toLowerCase().includes(search.toLowerCase())
      ),
    [items, tierFilter, category, search]
  );

  const cartLines = Object.entries(cart).filter(([, qty]) => qty > 0);
  const itemCount = cartLines.length;
  const cartTotal = cartLines.reduce((sum, [skuId, qty]) => {
    const item = items.find((i) => i.skuId === skuId);
    return sum + qty * (item?.mrpInr ?? 0);
  }, 0);

  // A line commits (reserves stock) if enough is available; otherwise the
  // whole line goes to Ops as a product request instead - no partial split
  // of a single line between the two, same "no partial approval" spirit as
  // the rest of the order flow.
  const toCommit = cartLines.filter(([skuId, qty]) => qty <= (items.find((i) => i.skuId === skuId)?.currentStock ?? 0));
  const toRequest = cartLines.filter(([skuId, qty]) => qty > (items.find((i) => i.skuId === skuId)?.currentStock ?? 0));

  function setQty(skuId: string, qty: number) {
    const clamped = Math.max(0, Math.floor(qty) || 0);
    setCart((prev) => ({ ...prev, [skuId]: clamped }));
  }

  async function submitOrder() {
    if (!user?.accountId) return;
    setBusy(true);
    try {
      if (toCommit.length > 0) {
        await dataClient.commitOrder(
          user.accountId,
          toCommit.map(([skuId, qty]) => ({ skuId, qty })),
          user.name
        );
      }
      await Promise.all(toRequest.map(([skuId, qty]) => dataClient.requestProduct(user.accountId!, skuId, qty, null)));
      // Committed/My Requests read the shared store now (see liveStore.ts) -
      // refresh the slices this order just touched so they show up there
      // immediately instead of waiting for the next poll tick.
      if (toCommit.length > 0) {
        liveStore.refreshInventory();
        liveStore.refreshRequests();
      }
      if (toRequest.length > 0) liveStore.refreshProductRequests();

      const parts: string[] = [];
      if (toCommit.length > 0) parts.push("reserved from stock — push it from the Committed tab");
      if (toRequest.length > 0) parts.push("sent to Ops as a request since there wasn't enough in stock");
      notificationStore.push({ kind: "success", title: "Order submitted", body: parts.join("; ") + "." });

      setCart({});
      setStage("browsing");
      navigate(toCommit.length > 0 ? "/b2b/committed" : "/b2b/requests");
    } catch (err) {
      notificationStore.push({
        kind: "danger",
        title: "Couldn't submit order",
        body: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (stage === "preview") {
    const buttonLabel =
      toRequest.length === 0 ? "Commit order" : toCommit.length === 0 ? "Send request" : "Commit & request";
    const busyLabel =
      toRequest.length === 0 ? "Committing…" : toCommit.length === 0 ? "Sending…" : "Submitting…";

    return (
      <div className="mx-auto max-w-xl">
        <h1 className="font-display text-2xl font-semibold">Review order</h1>
        <p className="mb-6 text-sm text-ink-soft">Nothing is reserved yet — committing locks in these quantities.</p>

        {toCommit.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">Committing now</p>
            <div className="divide-y divide-line rounded-xl border border-line bg-paper-raised">
              {toCommit.map(([skuId, qty]) => {
                const item = items.find((i) => i.skuId === skuId);
                return (
                  <div key={skuId} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">{item?.productName ?? skuId}</p>
                      <p className="font-mono text-[11.5px] tabular-nums text-ink-faint">
                        {qty} × ₹{item?.mrpInr ?? 0}
                      </p>
                    </div>
                    <p className="font-mono tabular-nums">₹{qty * (item?.mrpInr ?? 0)}</p>
                  </div>
                );
              })}
              <div className="flex items-center justify-between px-4 py-3">
                <p className="font-semibold">Total</p>
                <p className="font-mono text-base font-semibold tabular-nums">
                  ₹{toCommit.reduce((sum, [skuId, qty]) => sum + qty * (items.find((i) => i.skuId === skuId)?.mrpInr ?? 0), 0)}
                </p>
              </div>
            </div>
          </div>
        )}

        {toRequest.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-warning">
              Requesting from Ops — not enough in stock
            </p>
            <div className="divide-y divide-line rounded-xl border border-warning bg-paper-raised">
              {toRequest.map(([skuId, qty]) => {
                const item = items.find((i) => i.skuId === skuId);
                return (
                  <div key={skuId} className="flex items-center justify-between px-4 py-3 text-sm">
                    <p className="font-medium">{item?.productName ?? skuId}</p>
                    <p className="font-mono text-[11.5px] tabular-nums text-ink-soft">
                      {qty} requested · {item?.currentStock ?? 0} avail
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={() => setStage("browsing")}
            disabled={busy}
            className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft transition-colors hover:text-ink"
          >
            Back to catalog
          </button>
          <button
            onClick={submitOrder}
            disabled={busy}
            className="ml-auto rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
          >
            {busy ? busyLabel : buttonLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">New Order</h1>
            <RefreshButton onRefresh={liveStore.refreshInventory} />
          </div>
          <p className="text-sm text-ink-soft">
            Add items, then review. In-stock quantities commit; anything over what's available gets sent to Ops as a request.
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent sm:w-56"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setTierFilter("all")}
            title="All tiers"
            className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
              tierFilter === "all" ? "border-ink-faint text-ink" : "border-line text-ink-faint hover:text-ink-soft"
            }`}
          >
            All
          </button>
          {TIER_ORDER.map((tier) => (
            <button
              key={tier}
              onClick={() => setTierFilter(tier)}
              title={TIER_CONFIG[tier].label}
              aria-label={`Filter by ${TIER_CONFIG[tier].label} tier`}
              className={`h-6 w-6 rounded-full transition-transform ${TIER_CONFIG[tier].solid} ${
                tierFilter === tier ? "scale-110 ring-2 ring-ink-faint ring-offset-2 ring-offset-paper" : "hover:scale-105"
              }`}
            />
          ))}
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-line bg-paper-raised px-2.5 py-1 text-[13px] transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingState label="Loading catalog…" />
      ) : filtered.length === 0 ? (
        <EmptyState title="No products match" body="Try a different search term, tier, or category." />
      ) : (
        <div className="space-y-3 pb-20">
          {Array.from(
            // Grouped by category only - tier is already visible per item via
            // CatalogRow's colored left border, so a separate tier section on
            // top of that just re-fragments the same categories into more,
            // smaller blocks. Tier still orders items within a category
            // (green first) so priority isn't lost, just not visually split.
            filtered
              .slice()
              .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || b.currentStock - a.currentStock)
              .reduce((byCategory, item) => {
                const list = byCategory.get(item.category) ?? [];
                list.push(item);
                byCategory.set(item.category, list);
                return byCategory;
              }, new Map<string, InventoryItem[]>())
          ).map(([cat, catItems]) => (
            <div key={cat}>
              <p className="mb-1 px-1 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                {cat} · {catItems.length}
              </p>
              <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-2 xl:grid-cols-3">
                {catItems.map((item) => (
                  <CatalogRow
                    key={item.skuId}
                    item={item}
                    qty={cart[item.skuId] ?? 0}
                    onChange={(qty) => setQty(item.skuId, qty)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {itemCount > 0 && (
        <div className="rise-in fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-line bg-paper-raised px-5 py-3 shadow-card">
          <div className="flex items-center gap-4">
            <span className="text-sm">
              <span className="font-mono tabular-nums">{itemCount}</span> item{itemCount === 1 ? "" : "s"} ·{" "}
              <span className="font-mono tabular-nums">₹{cartTotal}</span>
            </span>
            <button
              onClick={() => setStage("preview")}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.97]"
            >
              Review order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
