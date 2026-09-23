import { useEffect, useMemo, useState } from "react";
import { dataClient } from "../../lib/data";
import { liveStore, useLiveStore } from "../../lib/data/liveStore";
import { notificationStore } from "../../lib/integrations/notificationStore";
import { LoadingState } from "../../components/Spinner";
import { EmptyState } from "../../components/EmptyState";
import { RefreshButton } from "../../components/RefreshButton";
import { TIER_CONFIG, TIER_ORDER } from "../../components/TierBadge";
import { digitFitFontSizePx, isLargerPack, isOneServingPack } from "../../lib/inventory";
import { TierPicker } from "../../components/TierPicker";
import type { InventoryItem, Tier } from "../../lib/types";

type TierFilter = "all" | Tier;
type PackFilter = "all" | "standard" | "larger" | "single";

function packOf(skuId: string): Exclude<PackFilter, "all"> {
  if (isLargerPack(skuId)) return "larger";
  if (isOneServingPack(skuId)) return "single";
  return "standard";
}

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
      style={{ fontSize: `${digitFitFontSizePx(draft.length)}px` }}
      className="w-[4.5rem] shrink-0 rounded-md border-2 border-accent/40 bg-paper-raised px-1.5 py-1 text-center font-mono font-bold tabular-nums text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50 sm:w-24 sm:px-2"
    />
  );
}

function InventoryRow({
  item,
  pending,
  onStockChange,
  onActiveToggle,
  onTierChange,
}: {
  item: InventoryItem;
  pending: boolean;
  onStockChange: (skuId: string, value: number) => void;
  onActiveToggle: (skuId: string, active: boolean) => void;
  onTierChange: (skuId: string, tier: Tier) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 border-l-2 px-3 py-1.5 transition-colors hover:bg-paper-raised ${
        pending ? "border-l-accent bg-accent-soft/30" : "border-l-transparent"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] leading-tight">
          {item.productName}
          {isLargerPack(item.skuId) && <span className="ml-1 font-semibold text-accent-ink">(L)</span>}
          {isOneServingPack(item.skuId) && <span className="ml-1 font-semibold text-accent-ink">(S)</span>}
        </p>
        <p className="font-mono text-[10px] tabular-nums text-ink-faint">
          {item.grammageG}g · ₹{item.mrpInr}
        </p>
      </div>
      <TierPicker value={item.tier} onChange={(tier) => onTierChange(item.skuId, tier)} />
      <StockInput value={item.currentStock} onCommit={(next) => onStockChange(item.skuId, next)} />
      <input
        type="checkbox"
        checked={item.active}
        onChange={(e) => onActiveToggle(item.skuId, e.target.checked)}
        className="h-4 w-4 shrink-0 accent-accent"
      />
    </div>
  );
}

interface PendingChange {
  stock?: number;
  active?: boolean;
  tier?: Tier;
}

export function InventoryPage() {
  // Reads shared state instead of fetching its own copy on mount - see
  // liveStore.ts. Only a manual refresh or a mutation made right here
  // updates it; navigating to/from this page never fires a network call.
  const { inventory: liveItems, inventoryReady } = useLiveStore();
  const loading = !inventoryReady;
  const [category, setCategory] = useState("All");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [packFilter, setPackFilter] = useState<PackFilter>("all");
  const [search, setSearch] = useState("");

  // Edits are held here rather than sent immediately - the Update button
  // flushes everything collected so far as one batched request (see
  // dataClient.updateInventoryFields) instead of one request per field.
  const [pending, setPending] = useState<Record<string, PendingChange>>({});
  const [updating, setUpdating] = useState(false);
  const pendingCount = Object.keys(pending).length;

  const items = useMemo(
    () => liveItems.map((item) => (pending[item.skuId] ? { ...item, ...pending[item.skuId] } : item)),
    [liveItems, pending]
  );

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.category)))], [items]);
  const filtered = items.filter(
    (i) =>
      (category === "All" || i.category === category) &&
      (tierFilter === "all" || i.tier === tierFilter) &&
      (packFilter === "all" || packOf(i.skuId) === packFilter) &&
      i.productName.toLowerCase().includes(search.toLowerCase())
  );

  // Grouped by category so a long list can be scanned/worked category by
  // category instead of one flat block - the dropdown above still narrows
  // to a single category for focused counting on a small screen.
  const groups = useMemo(() => {
    const byCategory = new Map<string, InventoryItem[]>();
    for (const item of filtered) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }
    return Array.from(byCategory.entries());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  function reportError(title: string, err: unknown) {
    notificationStore.push({
      kind: "danger",
      title,
      body: err instanceof Error ? err.message : "Something went wrong.",
    });
  }

  function setPendingField(skuId: string, change: PendingChange) {
    setPending((prev) => ({ ...prev, [skuId]: { ...prev[skuId], ...change } }));
  }

  function handleStockChange(skuId: string, value: number) {
    setPendingField(skuId, { stock: Math.max(0, value) });
  }

  function handleActiveToggle(skuId: string, active: boolean) {
    setPendingField(skuId, { active });
  }

  function handleTierChange(skuId: string, tier: Tier) {
    setPendingField(skuId, { tier });
  }

  async function handleUpdate() {
    const updates = Object.entries(pending).flatMap(([skuId, change]) => {
      const fields: { skuId: string; field: "stock" | "active" | "tier"; value: number | boolean | Tier }[] = [];
      if (change.stock !== undefined) fields.push({ skuId, field: "stock", value: change.stock });
      if (change.active !== undefined) fields.push({ skuId, field: "active", value: change.active });
      if (change.tier !== undefined) fields.push({ skuId, field: "tier", value: change.tier });
      return fields;
    });
    if (updates.length === 0) return;
    setUpdating(true);
    try {
      await dataClient.updateInventoryFields(updates);
      setPending({});
      liveStore.refreshInventory();
      notificationStore.push({
        kind: "success",
        title: "Inventory updated",
        body: `${pendingCount} item${pendingCount === 1 ? "" : "s"} saved in one request.`,
      });
    } catch (err) {
      reportError("Couldn't save changes", err);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">Inventory</h1>
            <RefreshButton onRefresh={liveStore.refreshInventory} />
            <button
              onClick={handleUpdate}
              disabled={pendingCount === 0 || updating}
              className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
            >
              {updating ? "Updating…" : pendingCount > 0 ? `Update (${pendingCount})` : "Update"}
            </button>
          </div>
          <p className="text-sm text-ink-soft">
            {loading ? "Loading…" : `${items.length} SKUs from the ratecard. Stock starts at 0 until counted.`}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent sm:w-56"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent sm:w-auto"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={packFilter}
            onChange={(e) => setPackFilter(e.target.value as PackFilter)}
            className="w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent sm:w-auto"
          >
            <option value="all">All pack types</option>
            <option value="standard">Standard</option>
            <option value="larger">Larger pack (L)</option>
            <option value="single">One serving (S)</option>
          </select>
        </div>
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
      ) : filtered.length === 0 ? (
        <EmptyState title="No products match" body="Try a different search term, tier, or category." />
      ) : (
        <div className="columns-1 gap-4 pb-4 lg:columns-2 xl:columns-3">
          {groups.map(([cat, catItems]) => (
            <div key={cat} className="mb-4 break-inside-avoid">
              <div className="mb-1.5 flex items-baseline gap-2 border-b-2 border-accent/40 px-1 pb-1.5">
                <span className="font-display text-[15px] font-semibold text-ink">{cat}</span>
                <span className="font-mono text-[11px] tabular-nums text-ink-faint">{catItems.length}</span>
              </div>
              <div className="divide-y divide-line rounded-lg border border-line">
                {catItems.map((item) => (
                  <InventoryRow
                    key={item.skuId}
                    item={item}
                    pending={pending[item.skuId] !== undefined}
                    onStockChange={handleStockChange}
                    onActiveToggle={handleActiveToggle}
                    onTierChange={handleTierChange}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
