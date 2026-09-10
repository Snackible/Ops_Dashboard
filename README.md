# Snackible Ops Dashboard

B2B ordering + internal fulfillment platform for Snackible.

## Running it

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Sign in as either role from the login
screen — B2B picks one of two seed accounts, Ops just takes a name (no
password yet; auth is mocked, see below). Runs entirely on a `localStorage`
mock by default — no setup required.

## The order flow

B2B orders happen in stages, not a single submit:

1. **Add items** — browsing the catalog and adjusting quantities is purely
   local state. Nothing is reserved yet.
2. **Review** — a cost/quantity summary before anything touches stock.
3. **Commit** — reserves every line item's quantity from
   `InventoryItem.currentStock` immediately (atomically, see the Supabase
   RPCs below). This is the point of no casual return — the B2B account can
   still choose not to push, but the stock is held either way.
4. **Push** — sends the committed order to Ops (status `draft` → `pending`)
   and fires the `RequestSubmitted` event.
5. **Ops decides** — Approve (stock stays deducted) or Decline (stock is
   released back). No partial approval — it's whole-order either way.

## Tiers

Each inventory item carries a `tier`: `green` / `yellow` / `orange` / `red`.
This is **purely a manual Ops call** — nothing computes it from stock counts
or anything else. Ops re-files items via the color pickers on the Inventory
table or the drag-and-drop board at `/ops/tiers`. B2B sees the same tiers
(read-only) as a filter and a color strip on each catalog row.

## What's real vs. mocked right now

- **Catalog** (`src/data/catalog.json`) — the actual 73 SKUs transcribed from
  the Snackible ratecard sheet. Stock starts at 0 for every item.
- **Auth** — mocked (`src/lib/auth/authStore.ts`), no password check. Swapping
  in real auth means replacing this module's `signIn`/`getCurrentUser` with
  calls to a real provider; nothing that calls `useAuth()` needs to change.
- **Data** — defaults to `src/lib/data/mockDataClient.ts` (localStorage).
  Set the Supabase env vars below to switch to the real backend — see
  **Real backend (Supabase)**.
- **Fulfillment sheet export** — `src/lib/integrations/fulfillmentSheetLog.ts`
  writes to a mock "sheet" in `localStorage` instead of the real Google
  Sheets API (visible under Ops → History → Fulfillment sheet). The one
  function that needs to change for the real integration is
  `appendRowsToSheet` — everything else is unaware it's a sheet at all.
- **Sound alert** — a synthesized chime (`src/lib/integrations/soundAlert.ts`),
  no audio file to ship.

## Real backend (Supabase)

The app talks to data through one interface (`DataClient`,
`src/lib/data/dataClient.ts`); `mockDataClient` and `supabaseDataClient` are
two implementations of it, picked in `src/lib/data/index.ts` based on
whether Supabase env vars are set.

**Setup:**

1. Create a project at [supabase.com](https://supabase.com) (free tier is
   plenty at this scale).
2. In the SQL editor, run `supabase/schema.sql`, then `supabase/seed.sql`
   (regenerate the latter with `node scripts/generate-seed-sql.js` if the
   ratecard changes).
3. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from Project Settings → API.
4. Restart `npm run dev` — it now talks to Postgres instead of localStorage.

**Why this scales**: `commitItem`, `pushOrder`, and `decideRequest` call
Postgres functions (`commit_item`, `push_order`, `decide_request` in
`schema.sql`) instead of doing read-then-write from the browser, so a stock
delta is computed and applied in one transaction — safe under concurrent
commits from multiple B2B accounts. A Realtime subscription
(`startRealtimeSync` in `supabaseDataClient.ts`) feeds the same event bus
every popup/sound/sheet-log subscriber already listens on, so an Ops
dashboard open in one browser sees a push made from a completely different
browser — polling isn't involved.

**Not done yet**: Row Level Security is permissive (`schema.sql` has the
real policies commented in as a checklist) because the app's login is still
mocked — there's no `auth.uid()` to scope policies to until real Supabase
Auth replaces `authStore.ts`. Tighten this before handling real accounts.

## Deploying (Vercel)

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In Vercel, "Import Project" from the GitHub repo — it auto-detects Vite,
   no config needed.
3. Add the same two env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
   under Project Settings → Environment Variables.
4. Deploy. Every push to `master` redeploys automatically once connected.

## Architecture: why adding something later should be cheap

Core logic never calls a side effect directly. Submitting or deciding a
request emits an event on `src/lib/events.ts`'s bus
(`RequestSubmitted`, `RequestApproved`, `RequestDeclined`, `InventoryUpdated`);
everything that reacts to it is an independent subscriber registered in
`src/lib/integrations/registerSubscribers.ts`:

- `opsPopupSound.ts` — toast + chime for whoever's on the Ops dashboard
- `b2bPopup.ts` — toast for the requesting B2B account
- `fulfillmentSheetLog.ts` — writes approved line items to the sheet

**To add a new integration later** (email/SMS, an ERP export, analytics):
write a new `registerX()` module that calls `eventBus.on(...)`, add one line
to `registerSubscribers.ts`. Nothing in `CatalogPage`, `QueuePage`, or either
`DataClient` implementation needs to change.

Other extension points already in place:

- `InventoryItem.metadata` and `B2BAccount.pricingTierId` exist on the types
  now, unused, so the feature that needs them doesn't need a migration.
- Role checks are a single `role` field + `RequireRole` — a third role is a
  new value, not a new auth system.

## Not built yet

Real authentication, tightened Row Level Security, email/SMS notifications,
and the real Google Sheets write (see the fulfillment sheet section above).
