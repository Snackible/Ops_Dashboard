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

B2B orders happen in three tabs, not a single submit:

1. **New Order** — browsing the catalog and adjusting quantities is purely
   local state. Nothing is reserved yet.
2. **Review** (still on New Order) — a cost/quantity summary before anything
   touches stock, then **Commit**, which reserves every line item's quantity
   from `InventoryItem.currentStock` atomically (either the whole order
   reserves or none of it does — see the Apps Script functions below).
3. **Committed** — every committed-but-unpushed order lives here. Nothing
   auto-pushes; an account can hold several committed orders at once and
   push each independently whenever it's ready.
4. **My Requests** — once pushed, an order moves here and Ops sees it in
   their queue. Approve keeps the stock deducted; Decline releases it back.
   No partial approval — a request is approved or declined as a whole.

## Tiers

Each inventory item carries a `tier`: `green` / `yellow` / `orange` / `red`.
This is **purely a manual Ops call** — nothing computes it from stock counts
or anything else. Ops re-files items via the color pickers on the Inventory
table or the drag-and-drop board at `/ops/tiers`. B2B sees the same tiers
(read-only) as a filter and a color strip on each catalog row.

## What's real vs. mocked right now

- **Catalog** (`src/data/catalog.json`) — the actual 73 SKUs transcribed from
  the Snackible ratecard sheet. Used only to seed the localStorage mock;
  the real backend reads the ratecard directly (see below).
- **Auth** — mocked (`src/lib/auth/authStore.ts`), no password check. Swapping
  in real auth means replacing this module's `signIn`/`getCurrentUser` with
  calls to a real provider; nothing that calls `useAuth()` needs to change.
- **Data** — defaults to `src/lib/data/mockDataClient.ts` (localStorage).
  Set `VITE_SHEETS_API_URL` to switch to the real Google Sheets backend —
  see **Real backend (Google Sheets)**.
- **Sound alert** — a synthesized chime (`src/lib/integrations/soundAlert.ts`),
  no audio file to ship.

## Real backend (Google Sheets)

The app talks to data through one interface (`DataClient`,
`src/lib/data/dataClient.ts`); `mockDataClient` and `sheetsDataClient` are
two implementations of it, picked in `src/lib/data/index.ts` based on
whether `VITE_SHEETS_API_URL` is set. The Sheets side is a small Apps Script
web app (`apps-script/Code.gs`) bound to a spreadsheet — the spreadsheet
*is* the database, one tab per table.

**Setup:**

1. Open the spreadsheet that already has your ratecard tab (Category |
   Product Name | Grammage (g) | MRP (INR) | Shelf Life) → Extensions →
   Apps Script.
2. Paste in `apps-script/Code.gs` and `apps-script/Catalog.gs` (regenerate
   the latter with `node scripts/generate-apps-script-catalog.js` if you
   ever need the bundled-snapshot fallback to match a newer ratecard).
3. Run `setupSheets()` once. It adds the operational tabs — `Inventory`,
   `Accounts`, `Orders`, `OrderLines`, `FulfillmentLog` — alongside your
   existing ones, and seeds `Inventory` by reading the real rows straight
   out of your ratecard tab (`extractCatalogFromRatecard_`), skipping the
   section-banner rows ("Best Sellers") and blank spacers that live in
   between. `Catalog.gs` only kicks in as a fallback if no ratecard-shaped
   tab is found.
4. (Optional) Project Settings → Script Properties → add `API_TOKEN` if you
   want a shared secret, not just an unguessable URL, gating the endpoint.
5. Deploy → New deployment → Web app → Execute as **Me**, Who has access
   **Anyone**. Copy the `/exec` URL.
6. Copy `.env.example` to `.env.local`, set `VITE_SHEETS_API_URL` (and
   `VITE_SHEETS_API_TOKEN` if you set one), restart `npm run dev`.

**Why this is safe under concurrent orders**: Sheets has no transactions, so
`commitOrder_`, `pushOrder_`, and `decideRequest_` all run inside
`withLock_()` — a `LockService` mutex shared across every request the script
handles. Without it, two B2B accounts committing at the same moment could
both read "12 in stock" and both reserve 10. `commitOrder_` also validates
every line against current stock *before* writing anything, so an order
either reserves in full or not at all.

**Live updates without a change feed**: Sheets has no realtime subscription
API, so `sheetsPolling.ts` polls `getRequests` every few seconds and diffs
statuses against what it saw last time, emitting the same `RequestSubmitted`
/ `RequestApproved` / `RequestDeclined` events onto the event bus that
`opsPopupSound.ts` and `b2bPopup.ts` already listen for — an Ops tab still
hears about a push made from a completely different browser, just on a
poll cycle instead of instantly.

**Fulfillment log**: written server-side, inside the same `decideRequest_`
call that approves an order — not as a separate step that could be skipped
if a browser closes mid-approval.

**Not done yet**: the Apps Script endpoint is either a shared secret
(`API_TOKEN`) or an unguessable URL — there's no per-account authorization,
because the app's login is still mocked. Anyone with the URL (and token, if
set) can act as any account. Tighten this before handling real orders: the
natural next step is checking a real identity in `route_()` once real auth
replaces `authStore.ts`.

## Deploying the frontend (Vercel)

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In Vercel, "Import Project" from the GitHub repo — it auto-detects Vite,
   no config needed.
3. Add `VITE_SHEETS_API_URL` (and `VITE_SHEETS_API_TOKEN` if set) under
   Project Settings → Environment Variables.
4. Deploy. Every push to `master` redeploys automatically once connected.

The backend itself needs no separate deployment — the Apps Script web app
*is* the deployment, and it's already live the moment you complete the
setup steps above.

## Architecture: why adding something later should be cheap

Core logic never calls a side effect directly. Submitting or deciding a
request emits an event on `src/lib/events.ts`'s bus
(`RequestSubmitted`, `RequestApproved`, `RequestDeclined`, `InventoryUpdated`);
everything that reacts to it is an independent subscriber registered in
`src/lib/integrations/registerSubscribers.ts`:

- `opsPopupSound.ts` — toast + chime for whoever's on the Ops dashboard
- `b2bPopup.ts` — toast for the requesting B2B account
- `fulfillmentSheetLog.ts` — mock-only; writes approved line items to a
  localStorage stand-in for the sheet (the real backend writes these rows
  itself, see above)

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

Real authentication, per-account authorization on the Apps Script endpoint,
and email/SMS notifications.
