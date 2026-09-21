import { useEffect, useMemo, useState } from "react";
import { dataClient } from "../../lib/data";
import { liveStore, useLiveStore } from "../../lib/data/liveStore";
import { notificationStore } from "../../lib/integrations/notificationStore";
import { LoadingState } from "../../components/Spinner";
import { RefreshButton } from "../../components/RefreshButton";
import { TIER_CONFIG, TIER_ORDER } from "../../components/TierBadge";
import { TierPicker } from "../../components/TierPicker";
import type { Tier } from "../../lib/types";

type TierFilter = "all" | Tier;

/**
 * A stock count field synced to the server can't be fully controlled by the
 * server value - committing a keystroke means a network round trip, and the
 * next keystroke arrives before it resolves. Editing its own local draft and
 * only committing on blur/Enter avoids that fight (and avoids firing one
 * write per digit against a backend where a write is a real network call).
 */
function StockInput({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const next = Math.max(0, Number(draft) || 0);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }

  return (
    <input
      type="number"
      min={0}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-20 rounded-md border border-line bg-paper px-2 py-1 text-center font-mono tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
    />
  );
}

export function InventoryPage() {
  // Reads shared state instead of fetching its own copy on mount - see
  // liveStore.ts. Only a manual refresh or a mutation made right here
  // updates it; navigating to/from this page never fires a network call.
  const { inventory: items, inventoryReady } = useLiveStore();
  const loading = !inventoryReady;
  const [category, setCategory] = useState("All");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.category)))], [items]);
  const filtered = items.filter(
    (i) => (category === "All" || i.category === category) && (tierFilter === "all" || i.tier === tierFilter)
  );

  function reportError(title: string, err: unknown) {
    notificationStore.push({
      kind: "danger",
      title,
      body: err instanceof Error ? err.message : "Something went wrong.",
    });
  }

  async function handleStockChange(skuId: string, value: number) {
    try {
      await dataClient.updateStock(skuId, Math.max(0, value));
      liveStore.refreshInventory();
    } catch (err) {
      reportError("Couldn't update stock", err);
      liveStore.refreshInventory();
    }
  }

  async function handleActiveToggle(skuId: string, active: boolean) {
    try {
      await dataClient.setActive(skuId, active);
      liveStore.refreshInventory();
    } catch (err) {
      reportError("Couldn't update active status", err);
      liveStore.refreshInventory();
    }
  }

  async function handleTierChange(skuId: string, tier: Tier) {
    try {
      await dataClient.setTier(skuId, tier);
      liveStore.refreshInventory();
    } catch (err) {
      reportError("Couldn't update tier", err);
      liveStore.refreshInventory();
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">Inventory</h1>
            <RefreshButton onRefresh={liveStore.refreshInventory} />
          </div>
          <p className="text-sm text-ink-soft">
            {loading ? "Loading…" : `${items.length} SKUs from the ratecard. Stock starts at 0 until counted.`}
          </p>
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-line bg-paper-raised px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex items-center gap-1.5">
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

      {loading ? (
        <LoadingState label="Loading inventory…" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper-raised text-left font-mono text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5">Product</th>
                <th className="px-4 py-2.5">Tier</th>
                <th className="px-4 py-2.5">MRP</th>
                <th className="px-4 py-2.5">Stock</th>
                <th className="px-4 py-2.5">Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.skuId} className="border-b border-line transition-colors last:border-0 hover:bg-paper-raised">
                  <td className="px-4 py-2.5">
                    <p>{item.productName}</p>
                    <p className="font-mono text-[11px] text-ink-faint">{item.category}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <TierPicker value={item.tier} onChange={(tier) => handleTierChange(item.skuId, tier)} />
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums">₹{item.mrpInr}</td>
                  <td className="px-4 py-2.5">
                    <StockInput value={item.currentStock} onCommit={(next) => handleStockChange(item.skuId, next)} />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={item.active}
                      onChange={(e) => handleActiveToggle(item.skuId, e.target.checked)}
                      className="h-4 w-4 accent-accent"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
