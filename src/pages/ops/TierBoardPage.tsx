import { useMemo, useState } from "react";
import { dataClient } from "../../lib/data";
import { liveStore, useLiveStore } from "../../lib/data/liveStore";
import { notificationStore } from "../../lib/integrations/notificationStore";
import { RefreshButton } from "../../components/RefreshButton";
import { TIER_CONFIG, TIER_ORDER } from "../../components/TierBadge";
import { SkeletonCard } from "../../components/Skeleton";
import { isLargerPack } from "../../lib/inventory";
import type { InventoryItem, Tier } from "../../lib/types";

function TierColumn({
  tier,
  items,
  draggedSku,
  pendingSkus,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  tier: Tier;
  items: InventoryItem[];
  draggedSku: string | null;
  pendingSkus: Set<string>;
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
            className={`cursor-grab select-none rounded-md border px-2.5 py-1.5 transition-opacity active:cursor-grabbing ${
              draggedSku === item.skuId ? "opacity-40" : "opacity-100"
            } ${pendingSkus.has(item.skuId) ? "border-accent bg-accent-soft/30" : "border-line bg-paper-raised"}`}
          >
            <p className="text-[12.5px] font-medium leading-tight">
              {item.productName}
              {isLargerPack(item.skuId) && <span className="ml-1 font-semibold text-accent-ink" title="Larger Pack">(L)</span>}
            </p>
            <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-ink-faint">
              {item.category} · {item.grammageG}g · stock {item.currentStock}
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
  // Reads shared state instead of fetching its own copy on mount - see
  // liveStore.ts. Navigating to/from this page never fires a network call
  // on its own; only a manual refresh or clicking Update sends anything.
  const { inventory: liveItems, inventoryReady } = useLiveStore();
  const loading = !inventoryReady;
  const [category, setCategory] = useState("All");
  const [draggedSku, setDraggedSku] = useState<string | null>(null);

  // A drop just re-files the item locally; nothing is sent to the server
  // until Update is clicked, which flushes every pending re-file as one
  // batched request instead of one per drop (see dataClient.updateInventoryFields).
  const [pendingTiers, setPendingTiers] = useState<Record<string, Tier>>({});
  const [updating, setUpdating] = useState(false);
  const pendingCount = Object.keys(pendingTiers).length;

  const items = useMemo(
    () => liveItems.map((item) => (pendingTiers[item.skuId] ? { ...item, tier: pendingTiers[item.skuId] } : item)),
    [liveItems, pendingTiers]
  );

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.category)))], [items]);
  const filtered = category === "All" ? items : items.filter((i) => i.category === category);

  function handleDrop(tier: Tier) {
    if (!draggedSku) return;
    const item = items.find((i) => i.skuId === draggedSku);
    setDraggedSku(null);
    if (!item || item.tier === tier) return;
    setPendingTiers((prev) => ({ ...prev, [draggedSku]: tier }));
  }

  async function handleUpdate() {
    const updates = Object.entries(pendingTiers).map(([skuId, tier]) => ({ skuId, field: "tier" as const, value: tier }));
    if (updates.length === 0) return;
    setUpdating(true);
    try {
      await dataClient.updateInventoryFields(updates);
      setPendingTiers({});
      liveStore.refreshInventory();
      notificationStore.push({
        kind: "success",
        title: "Tiers updated",
        body: `${pendingCount} item${pendingCount === 1 ? "" : "s"} re-filed in one request.`,
      });
    } catch (err) {
      notificationStore.push({
        kind: "danger",
        title: "Couldn't save tiers",
        body: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">Tiers</h1>
            <RefreshButton onRefresh={liveStore.refreshInventory} />
            <button
              onClick={handleUpdate}
              disabled={pendingCount === 0 || updating}
              className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
            >
              {updating ? "Updating…" : pendingCount > 0 ? `Update (${pendingCount})` : "Update"}
            </button>
          </div>
          <p className="text-sm text-ink-soft">Drag a product between columns to re-file it.</p>
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
              pendingSkus={new Set(Object.keys(pendingTiers))}
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
