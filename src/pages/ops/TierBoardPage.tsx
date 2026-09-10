import { useEffect, useMemo, useState } from "react";
import { dataClient } from "../../lib/data";
import { TIER_CONFIG, TIER_ORDER } from "../../components/TierBadge";
import { SkeletonCard } from "../../components/Skeleton";
import type { InventoryItem, Tier } from "../../lib/types";

function TierColumn({
  tier,
  items,
  draggedSku,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  tier: Tier;
  items: InventoryItem[];
  draggedSku: string | null;
  onDragStart: (skuId: string) => void;
  onDragEnd: () => void;
  onDrop: (tier: Tier) => void;
}) {
  const [over, setOver] = useState(false);
  const c = TIER_CONFIG[tier];

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop(tier);
      }}
      className={`flex min-h-[360px] flex-col rounded-xl border p-2.5 transition-colors ${
        over ? `${c.border} ${c.soft}` : "border-line bg-paper"
      }`}
    >
      <div className="mb-2.5 flex items-center justify-between px-1">
        <span className={`flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wide ${c.text}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${c.solid}`} />
          {c.label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-ink-faint">{items.length}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <div
            key={item.skuId}
            draggable
            onDragStart={() => onDragStart(item.skuId)}
            onDragEnd={onDragEnd}
            className={`cursor-grab select-none rounded-md border border-line bg-paper-raised px-2.5 py-1.5 transition-opacity active:cursor-grabbing ${
              draggedSku === item.skuId ? "opacity-40" : "opacity-100"
            }`}
          >
            <p className="text-[12.5px] font-medium leading-tight">{item.productName}</p>
            <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-ink-faint">
              {item.category} · stock {item.currentStock}
            </p>
          </div>
        ))}
        {items.length === 0 && (
          <div className="rounded-md border border-dashed border-line py-5 text-center text-[11.5px] text-ink-faint">
            Drop items here
          </div>
        )}
      </div>
    </div>
  );
}

export function TierBoardPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("All");
  const [draggedSku, setDraggedSku] = useState<string | null>(null);

  async function refresh() {
    const list = await dataClient.getInventory();
    setItems(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.category)))], [items]);
  const filtered = category === "All" ? items : items.filter((i) => i.category === category);

  async function handleDrop(tier: Tier) {
    if (!draggedSku) return;
    const item = items.find((i) => i.skuId === draggedSku);
    setDraggedSku(null);
    if (!item || item.tier === tier) return;
    await dataClient.setTier(draggedSku, tier);
    refresh();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Tiers</h1>
          <p className="text-sm text-ink-soft">
            Drag a product between columns to re-file it. Purely manual — nothing here is computed from stock counts.
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

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TIER_ORDER.map((tier) => (
            <TierColumn
              key={tier}
              tier={tier}
              items={filtered.filter((i) => i.tier === tier)}
              draggedSku={draggedSku}
              onDragStart={setDraggedSku}
              onDragEnd={() => setDraggedSku(null)}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}
