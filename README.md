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
   push each independently whenever it's ready. **Cancel** undoes a commit
   entirely (releases the reserved stock, removes the order) — for orders
   Ops never saw, not a decision Ops needs to weigh in on.
4. **My Requests** — once pushed, an order moves here and Ops sees it in
   their queue. Approve keeps the stock deducted; Decline releases it back.
   No partial approval — a request is approved or declined as a whole.

**Not enough stock?** On New Order, a quantity above what's available
doesn't get clamped — it's flagged, and on Review that line goes out as a
**product request** instead of a commit (a single order can be a mix of
both). Ops sees every pending request grouped by SKU at `/ops/product-requests`
— several accounts asking for the same product add up into one line — and
accepts, declines, or holds it with a deadline. Nothing here touches stock;
it's a demand signal, not a reservation. Status shows up back on the B2B
side under My Requests → Product requests.

## Tiers

Each inventory item carries a `tier`: `green` / `yellow` / `orange` / `red`.
This is **purely a manual Ops call** — nothing computes it from stock counts
or anything else. Ops re-files items via the color pickers on the Inventory
table or the drag-and-drop board at `/ops/tiers`. B2B sees the same tiers
(read-only) as a filter and a color strip on each catalog row.

## What's real vs. mocked right now

- **Catalog** (`src/data/catalog.json`) — the actual 73 SKUs transcribed from
  the Snackible ratecard sheet. Used only to seed the localStorage mock;
  the real backend reads your live ratecard tab directly, every call, with
  no copy in between (see below).
- **Auth** — mocked (`src/lib/auth/authStore.ts`), no password check. Swapping
  in real auth means replacing this module's `signIn`/`getCurrentUser` with
  calls to a real provider; nothing that calls `useAuth()` needs to change.
  **The B2B side currently has no login at all** — `RequireRole` auto-signs
  in a fixed `test-b2b` identity the moment any `/b2b` route is hit, purely
  so the flow can be tested without real accounts configured. Remove the
  bypass in `src/components/RequireRole.tsx` once real B2B auth exists.
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
*is* the database.

**Inventory has no tab of its own.** It's read and written directly against
*every* tab in the spreadsheet that already looks like a ratecard (any tab
with "Category" and "Product Name" header columns — column order and where
Grammage/MRP/Shelf Life sit don't matter, they're matched by header name).
A "Standard Grammage" tab and a "One Serving Pack" tab both contribute rows
as distinct, independently-stocked SKUs. Nothing is copied out of them,
and `setupSheets()` never writes to them.

Three columns get added to a ratecard tab the first time they're needed:

- **Current Stock** — missing entirely, or blank on a row, means 0. Type
  real counts in yourself, or let the app fill it in the moment someone
  commits/cancels an order, approves/declines a request, or Ops edits stock
  from the dashboard. (`Inventory` or `Stock` are also recognized if you'd
  rather name the column that.)
- **Active** — missing or blank means active.
- **Tier** — missing or blank means `yellow`.

**Larger Pack pricing.** If a row also has "Larger Pack Grammage (g)" and
"Larger Pack MRP (INR)" filled in (not blank or "NA"), that's a second,
independently-orderable SKU — same product, bigger pack, its own price and
its own `Larger Pack Current Stock` / `Larger Pack Active` / `Larger Pack
Tier` columns (created lazily the same way). Rows where those two columns
are blank or "NA" just produce the one standard-size SKU.

**Accounts/Orders/OrderLines/FulfillmentLog/ProductRequests live in a
separate spreadsheet from the ratecard**, on purpose — customer contact
info and order history shouldn't sit in whatever sheet the ratecard is
shared through, which may be visible to a much wider group (pricing,
other teams) than who should see customer data. Share that second
spreadsheet only with whoever actually needs it.

**Setup:**

1. Open the spreadsheet that already has your ratecard tab → Extensions →
   Apps Script.
2. Paste in `apps-script/Code.gs`.
3. Create a **new, separate** spreadsheet for accounts/orders — share it
   only with whoever should see customer data. Copy its ID out of the URL
   (`docs.google.com/spreadsheets/d/THIS_PART/edit`).
4. Project Settings → Script Properties → add `OPERATIONAL_SPREADSHEET_ID`
   with that ID. Without this, operational tabs fall back to living in the
   ratecard spreadsheet — fine for a quick test, not for real customer data.
5. Run `setupSheets()` once (optional) to seed two demo `Accounts` rows —
   the tabs themselves create automatically on first use either way. It
   never touches the ratecard tab.
6. (Optional) Also add `API_TOKEN` if you want a shared secret, not just an
   unguessable URL, gating the endpoint.
7. Deploy → New deployment → Web app → Execute as **Me**, Who has access
   **Anyone**. Copy the `/exec` URL.
8. Copy `.env.example` to `.env.local`, set `VITE_SHEETS_API_URL` (and
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
