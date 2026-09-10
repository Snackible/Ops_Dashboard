-- Snackible Ops Dashboard — Supabase schema
-- Run this once in the Supabase SQL editor (or via `supabase db push`) on a
-- fresh project. Mirrors src/lib/types.ts exactly, plus three RPC functions
-- that make commit / push / decide atomic under concurrent requests, since
-- stock deltas must never race between two B2B accounts committing at once.

create extension if not exists pgcrypto;

create table if not exists inventory_items (
  sku_id            text primary key,
  category          text not null,
  product_name      text not null,
  grammage_g        integer not null,
  mrp_inr           numeric(10, 2) not null,
  shelf_life_days   integer not null,
  current_stock     integer not null default 0 check (current_stock >= 0),
  active            boolean not null default true,
  tier              text not null default 'yellow' check (tier in ('green', 'yellow', 'orange', 'red')),
  metadata          jsonb
);

create table if not exists b2b_accounts (
  account_id        text primary key,
  company_name      text not null,
  contact_name      text not null,
  contact_email     text not null,
  contact_phone     text not null,
  pricing_tier_id   text
);

create table if not exists requests (
  request_id        text primary key default ('req-' || replace(gen_random_uuid()::text, '-', '')),
  account_id        text not null references b2b_accounts(account_id),
  status            text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'declined')),
  created_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  decided_at        timestamptz,
  decided_by        text,
  decision_note     text
);

create table if not exists request_line_items (
  line_item_id        text primary key default ('line-' || replace(gen_random_uuid()::text, '-', '')),
  request_id          text not null references requests(request_id) on delete cascade,
  sku_id              text not null references inventory_items(sku_id),
  qty                 integer not null check (qty > 0),
  unit_mrp_snapshot   numeric(10, 2) not null,
  unique (request_id, sku_id)
);

create index if not exists idx_requests_account_status on requests(account_id, status);
create index if not exists idx_requests_status on requests(status);
create index if not exists idx_line_items_request on request_line_items(request_id);

-- One draft per account, enforced so commitItem always knows which row to update.
create unique index if not exists uniq_one_draft_per_account
  on requests(account_id) where (status = 'draft');

-- ── RPCs: the atomic operations ─────────────────────────────────────────

-- Sets a line item's committed qty on the caller's draft order (creating the
-- draft if needed), adjusting inventory.current_stock by the delta in the
-- same transaction. Raises if the delta exceeds what's currently available.
create or replace function commit_item(p_account_id text, p_sku_id text, p_qty integer)
returns requests
language plpgsql
as $$
declare
  v_request requests;
  v_previous_qty integer := 0;
  v_delta integer;
  v_available integer;
  v_mrp numeric(10,2);
begin
  select current_stock, mrp_inr into v_available, v_mrp
    from inventory_items where sku_id = p_sku_id for update;
  if not found then
    raise exception 'Unknown SKU %', p_sku_id;
  end if;

  select * into v_request from requests
    where account_id = p_account_id and status = 'draft' for update;
  if not found then
    insert into requests (account_id, status) values (p_account_id, 'draft')
      returning * into v_request;
  end if;

  select qty into v_previous_qty from request_line_items
    where request_id = v_request.request_id and sku_id = p_sku_id;
  v_previous_qty := coalesce(v_previous_qty, 0);
  v_delta := p_qty - v_previous_qty;

  if v_delta > v_available then
    raise exception 'Only % available', v_available;
  end if;

  update inventory_items set current_stock = current_stock - v_delta where sku_id = p_sku_id;

  if p_qty = 0 then
    delete from request_line_items where request_id = v_request.request_id and sku_id = p_sku_id;
  else
    insert into request_line_items (request_id, sku_id, qty, unit_mrp_snapshot)
      values (v_request.request_id, p_sku_id, p_qty, v_mrp)
      on conflict (request_id, sku_id) do update set qty = excluded.qty;
  end if;

  return v_request;
end;
$$;

-- draft -> pending. Requires at least one line item.
create or replace function push_order(p_account_id text)
returns requests
language plpgsql
as $$
declare
  v_request requests;
  v_line_count integer;
begin
  select * into v_request from requests
    where account_id = p_account_id and status = 'draft' for update;
  if not found then
    raise exception 'No draft order to push';
  end if;

  select count(*) into v_line_count from request_line_items where request_id = v_request.request_id;
  if v_line_count = 0 then
    raise exception 'Add at least one item before pushing';
  end if;

  update requests set status = 'pending', submitted_at = now()
    where request_id = v_request.request_id
    returning * into v_request;
  return v_request;
end;
$$;

-- Approve keeps stock deducted. Decline releases every line item's reserved
-- qty back to current_stock. No partial approval.
create or replace function decide_request(p_request_id text, p_decided_by text, p_approve boolean, p_note text)
returns requests
language plpgsql
as $$
declare
  v_request requests;
begin
  if not p_approve then
    update inventory_items i set current_stock = i.current_stock + li.qty
      from request_line_items li
      where li.request_id = p_request_id and i.sku_id = li.sku_id;
  end if;

  update requests set
      status = case when p_approve then 'approved' else 'declined' end,
      decided_at = now(),
      decided_by = p_decided_by,
      decision_note = p_note
    where request_id = p_request_id
    returning * into v_request;

  if not found then
    raise exception 'Unknown request %', p_request_id;
  end if;
  return v_request;
end;
$$;

-- ── Row Level Security ──────────────────────────────────────────────────
-- NOT yet tied to real auth — the app's login is still mocked (see
-- src/lib/auth/authStore.ts). These are permissive so the app works once
-- Supabase Auth replaces the mock login; tighten before going live:
--   * b2b_accounts / requests / request_line_items should filter by
--     auth.uid() mapped to an account_id (e.g. via a profiles table).
--   * inventory writes (stock, tier, active) should require an "ops" role.
alter table inventory_items enable row level security;
alter table b2b_accounts enable row level security;
alter table requests enable row level security;
alter table request_line_items enable row level security;

create policy "read inventory" on inventory_items for select using (true);
create policy "read accounts" on b2b_accounts for select using (true);
create policy "read requests" on requests for select using (true);
create policy "read line items" on request_line_items for select using (true);

-- TODO once Supabase Auth is wired: replace with policies scoped to the
-- caller's role/account instead of `true`.
create policy "ops writes inventory" on inventory_items for update using (true);
create policy "anyone writes requests for now" on requests for all using (true);
create policy "anyone writes line items for now" on request_line_items for all using (true);

-- ── Realtime ─────────────────────────────────────────────────────────────
-- Enable replication so the app's realtime subscription (see
-- supabaseDataClient.ts) can drive the event bus across browser sessions —
-- e.g. an Ops dashboard open in one tab sees a push from a B2B tab live.
alter publication supabase_realtime add table requests;
alter publication supabase_realtime add table inventory_items;
