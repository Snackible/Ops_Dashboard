import { useEffect, useMemo, useState } from "react";
import { dataClient } from "../../lib/data";
import { useAuth } from "../../lib/auth/AuthContext";
import { notificationStore } from "../../lib/integrations/notificationStore";
import { SkeletonCard } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import type { InventoryItem } from "../../lib/types";

export function CatalogPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    dataClient.getInventory().then((list) => {
      setItems(list);
      setLoading(false);
    });
  }, []);

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.category)))], [items]);

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          i.active &&
          (category === "All" || i.category === category) &&
          i.productName.toLowerCase().includes(search.toLowerCase())
      ),
    [items, category, search]
  );

  const cartCount = Object.values(cart).reduce((sum, qty) => sum + (qty > 0 ? 1 : 0), 0);

  function setQty(skuId: string, qty: number) {
    setCart((prev) => ({ ...prev, [skuId]: Math.max(0, qty) }));
  }

  async function submitRequest() {
    if (!user?.accountId) return;
    const lineItems = Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([skuId, qtyRequested]) => ({ skuId, qtyRequested }));
    if (lineItems.length === 0) return;

    setSubmitting(true);
    try {
      await dataClient.submitRequest(user.accountId, lineItems);
      setCart({});
      notificationStore.push({
        kind: "success",
        title: "Request submitted",
        body: `Sent ${lineItems.length} item${lineItems.length === 1 ? "" : "s"} to Ops for review.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Catalog</h1>
          <p className="text-sm text-ink-soft">Browse Snackible's range and build a request for Ops.</p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="w-64 rounded-md border border-line bg-paper-raised px-3 py-2 text-sm placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
              category === c
                ? "border-accent bg-accent-soft text-accent-ink font-medium"
                : "border-line text-ink-soft hover:text-ink hover:border-ink-faint"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No products match" body="Try a different search term or category." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <div
              key={item.skuId}
              className="flex flex-col rounded-xl border border-line bg-paper-raised p-4 transition-all hover:-translate-y-0.5 hover:border-ink-faint hover:shadow-card"
            >
              <p className="font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">{item.category}</p>
              <h3 className="mt-1 font-display text-[15.5px] font-semibold leading-snug">{item.productName}</h3>
              <div className="mt-2 flex items-center gap-3 text-[12.5px] text-ink-soft">
                <span className="tabular-nums">{item.grammageG} g</span>
                <span>·</span>
                <span className="tabular-nums">₹{item.mrpInr}</span>
                <span>·</span>
                <span className="tabular-nums">{item.shelfLifeDays}d shelf life</span>
              </div>
              <p className="mt-1 font-mono text-[11.5px] text-ink-faint">Stock: {item.currentStock}</p>

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => setQty(item.skuId, (cart[item.skuId] ?? 0) - 1)}
                  className="h-8 w-8 rounded-md border border-line text-ink-soft transition-colors hover:border-ink-faint hover:text-ink hover:bg-paper active:scale-95"
                  aria-label={`Decrease quantity for ${item.productName}`}
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  value={cart[item.skuId] ?? 0}
                  onChange={(e) => setQty(item.skuId, Number(e.target.value))}
                  className="w-14 rounded-md border border-line bg-paper px-2 py-1 text-center text-sm tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  onClick={() => setQty(item.skuId, (cart[item.skuId] ?? 0) + 1)}
                  className="h-8 w-8 rounded-md border border-line text-ink-soft transition-colors hover:border-ink-faint hover:text-ink hover:bg-paper active:scale-95"
                  aria-label={`Increase quantity for ${item.productName}`}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {cartCount > 0 && (
        <div className="rise-in fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-line bg-paper-raised px-5 py-3 shadow-card">
          <div className="flex items-center gap-4">
            <span className="text-sm">
              <span className="font-mono tabular-nums">{cartCount}</span> item{cartCount === 1 ? "" : "s"} selected
            </span>
            <button
              onClick={submitRequest}
              disabled={submitting}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
