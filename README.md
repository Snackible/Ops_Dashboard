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
- **Data** — defaults to `src/lib/data/mockDataClient.ts` (localStorage) for
  local dev. Production builds automatically use the real backend — see
  **Real backend (Sheets API via Vercel Functions)**.
- **Sound alert** — a synthesized chime (`src/lib/integrations/soundAlert.ts`),
  no audio file to ship.

## Real backend (Sheets API via Vercel Functions)

The app talks to data through one interface (`DataClient`,
`src/lib/data/dataClient.ts`); `mockDataClient` and `sheetsDataClient` are
two implementations of it, picked in `src/lib/data/index.ts` (production
builds always use the real one, `VITE_USE_SHEETS_API=true` opts local
`vercel dev` into it too). `sheetsDataClient` calls `/api/sheets` — a
serverless function on the same Vercel deployment (`api/sheets.js` +
`server/`) that talks to the Google Sheets API v4 directly with a service
account. Google Sheets is still the database; there's just no Apps Script
in between anymore.

**Why this replaced the Apps Script version** (`apps-script/Code.gs`, kept
in the repo for reference but no longer used): every Apps Script web app
invocation pays a fixed authorization/sandbox tax - roughly 1-3+ seconds
- on top of whatever the script actually does, and its deployment model
makes it easy to silently orphan your live URL (a "new deployment" instead
of a "new version" of the existing one changes the URL). Calling the
Sheets API directly from a Vercel function removes both problems, and lets
multiple tabs be fetched in a single `batchGet` call instead of one Apps
Script round trip per tab.

**Inventory has no tab of its own.** It's read and written directly against
*every* tab in the ratecard spreadsheet that looks like a ratecard (any tab
with "Category" and "Product Name" header columns — column order and where
Grammage/MRP/Shelf Life sit don't matter, they're matched by header name).
A "Standard Grammage" tab and a "One Serving Pack" tab both contribute rows
as distinct, independently-stocked SKUs.

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

1. **Create a Google Cloud service account** with the Sheets API enabled
   (Google Cloud Console → APIs & Services → enable "Google Sheets API" →
   IAM & Admin → Service Accounts → create one → Keys → Add Key → JSON).
   You don't need to share anything with humans here — this account acts
   as its own Google identity.
2. **Share both spreadsheets** (the ratecard one, and a new, separate one
   for Accounts/Orders/etc.) with the service account's email address
   (looks like `something@your-project.iam.gserviceaccount.com`), Editor
   access. Copy each spreadsheet's ID out of its URL
   (`docs.google.com/spreadsheets/d/THIS_PART/edit`).
3. In Vercel → Project Settings → Environment Variables, add (Production
   and Preview):
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — from the JSON key file (`client_email`)
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — from the JSON key file
     (`private_key`) — paste it as-is, including the `\n` sequences
   - `RATECARD_SPREADSHEET_ID` — the ratecard spreadsheet's ID
   - `OPERATIONAL_SPREADSHEET_ID` — the separate accounts/orders spreadsheet's ID
   - (Optional) `API_TOKEN` — a shared secret if you want one beyond
     same-origin access
   None of these are `VITE_`-prefixed on purpose — they're server-only and
   never reach the browser, unlike the old Apps Script URL/token which
   were both bundled into client-side JS.
4. Deploy (push to `master`, or redeploy from the Vercel dashboard). The
   tabs (`Accounts`, `Orders`, `OrderLines`, `FulfillmentLog`,
   `ProductRequests`, `Lock`) create themselves with their header rows the
   first time anything touches them — nothing to run manually.

**Why this is safe-ish under concurrent orders**: Sheets has no
transactions, and serverless functions have no shared memory across
invocations the way Apps Script's `LockService` did within one script
project. `withLock()` (`server/lib/lock.js`) replicates a mutex using a
dedicated `Lock` tab in the operational spreadsheet: check the lock cell,
write your own token if it looks free, then read it back to confirm you
actually won before proceeding. It's not a true atomic compare-and-swap,
but it's a real, worthwhile guard for this app's actual concurrency (a
handful of B2B accounts, not a firehose) — see the comments in that file
for the honest tradeoff. `commitOrder` also validates every line against
current stock *before* writing anything, so an order either reserves in
full or not at all.

**Live updates without a change feed**: Sheets has no realtime subscription
API, so `sheetsPolling.ts` polls `getRequests` every few seconds and diffs
statuses against what it saw last time, emitting the same `RequestSubmitted`
/ `RequestApproved` / `RequestDeclined` events onto the event bus that
`opsPopupSound.ts` and `b2bPopup.ts` already listen for — an Ops tab still
hears about a push made from a completely different browser, just on a
poll cycle instead of instantly.

**Fulfillment log**: written server-side, inside the same `decideRequest`
call that approves an order — not as a separate step that could be skipped
if a browser closes mid-approval.

**Not done yet**: there's still no per-account authorization, because the
app's login is still mocked (and B2B has no login at all right now, see
above) — anyone who can reach the app can act as any account. The API
itself is now same-origin only (no public URL to leak), which is already a
real improvement over the Apps Script version, but real protection still
needs a real identity check in `api/sheets.js` once real auth exists.

## Deploying the frontend (Vercel)

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In Vercel, "Import Project" from the GitHub repo — it auto-detects Vite
   for the frontend and picks up `api/sheets.js` as a serverless function
   automatically, no config needed beyond the env vars above.
3. Deploy. Every push to `master` redeploys automatically once connected.

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
