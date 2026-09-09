# Snackible Ops Dashboard

B2B ordering + internal fulfillment platform for Snackible. See the full system
plan (data model, lifecycle diagram, extensibility architecture) for context —
this README covers just what's needed to run and extend the code.

## Running it

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Sign in as either role from the login
screen — B2B picks one of two seed accounts, Ops just takes a name (no
password yet; auth is mocked, see below).

## What's real vs. mocked right now

- **Catalog** (`src/data/catalog.json`) — the actual 73 SKUs transcribed from
  the Snackible ratecard sheet. Stock starts at 0 for every item, as instructed.
- **Auth** — mocked (`src/lib/auth/authStore.ts`), no password check. Swapping
  in real auth means replacing this module's `signIn`/`getCurrentUser` with
  calls to a real provider; nothing that calls `useAuth()` needs to change.
- **Data** — `src/lib/data/mockDataClient.ts` persists everything to
  `localStorage` and implements the `DataClient` interface
  (`src/lib/data/dataClient.ts`). A real backend (Supabase, etc.) is a second
  implementation of that same interface, swapped in at `src/lib/data/index.ts`.
- **Fulfillment sheet export** — `src/lib/integrations/fulfillmentSheetLog.ts`
  writes to a mock "sheet" in `localStorage` instead of the real Google
  Sheets API (visible under Ops → History → Fulfillment sheet). The one
  function that needs to change for the real integration is
  `appendRowsToSheet` — everything else is unaware it's a sheet at all.
- **Sound alert** — a synthesized chime (`src/lib/integrations/soundAlert.ts`),
  no audio file to ship.

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
to `registerSubscribers.ts`. Nothing in `CatalogPage`, `QueuePage`, or
`mockDataClient` needs to change.

Other extension points already in place:

- `InventoryItem.metadata`, `B2BAccount.pricingTierId`, and
  `InventoryItem.reorderThreshold` exist on the types now, unused, so the
  feature that needs them doesn't need a data migration.
- Role checks are a single `role` field + `RequireRole` — a third role is a
  new value, not a new auth system.

## Not built yet (see the roadmap in the system plan)

Low-stock alerts beyond the inline "low" badge, email/SMS notifications, a
real backend, and real authentication.
