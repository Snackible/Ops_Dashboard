import { useEffect, useMemo, useState } from "react";
import { dataClient } from "../../lib/data";
import { SkeletonRow } from "../../components/Skeleton";
import { TIER_CONFIG, TIER_ORDER } from "../../components/TierBadge";
import { TierPicker } from "../../components/TierPicker";
import type { InventoryItem, Tier } from "../../lib/types";

type TierFilter = "all" | Tier;

export function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [category, setCategory] = useState("All");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const list = await dataClient.getInventory();
    setItems(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.category)))], [items]);
  const filtered = items.filter(
    (i) => (category === "All" || i.category === category) && (tierFilter === "all" || i.tier === tierFilter)
  );

  async function handleStockChange(skuId: string, value: number) {
    await dataClient.updateStock(skuId, Math.max(0, value));
    refresh();
  }

  async function handleActiveToggle(skuId: string, active: boolean) {
    await dataClient.setActive(skuId, active);
    refresh();
  }

  async function handleTierChange(skuId: string, tier: Tier) {
    await dataClient.setTier(skuId, tier);
    refresh();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Inventory</h1>
          <p className="text-sm text-ink-soft">{items.length} SKUs from the ratecard. Stock starts at 0 until counted.</p>
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
        <div className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
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
                    <input
                      type="number"
                      min={0}
                      value={item.currentStock}
                      onChange={(e) => handleStockChange(item.skuId, Number(e.target.value))}
                      className="w-20 rounded-md border border-line bg-paper px-2 py-1 text-center font-mono tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
                    />
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
