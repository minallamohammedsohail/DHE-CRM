-- =====================================================================
-- Tile Business CRM — database schema
-- =====================================================================
-- Target:   Supabase (PostgreSQL 15+)
-- Timezone: business timezone is Asia/Kolkata; all timestamps stored as
--           timestamptz (UTC) and converted for display/boundaries.
-- Money:    numeric(12,2). Never floating point.
--
-- This file is the authoritative record of the schema. The schema must
-- never exist only inside the Supabase dashboard.
--
-- HOW TO APPLY
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   It is idempotent: safe to run more than once.
--
-- ORDER MATTERS: every table has RLS enabled in the same block that
-- creates it, so no table is ever reachable unprotected.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Helper function: maintain updated_at
-- ---------------------------------------------------------------------
-- search_path is pinned to '' so the function cannot be hijacked by a
-- schema placed earlier on a caller's search_path.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at = now(). Clients never set it.';


-- =====================================================================
-- 1. LEADS
-- =====================================================================

create table if not exists public.leads (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(btrim(name)) > 0),
  phone              text not null check (length(btrim(phone)) > 0),
  -- Normalised digits-only form, maintained by the database.
  -- Used for search and duplicate detection. regexp_replace is immutable,
  -- which a generated column requires.
  phone_norm         text generated always as
                       (regexp_replace(phone, '\D', '', 'g')) stored,
  location           text,
  source             text,
  requirement        text,
  interested_product text,
  budget             numeric(12,2) check (budget is null or budget >= 0),
  status             text not null default 'New'
                       check (status in ('New','Contacted','Interested',
                                         'Site Visit','Negotiation',
                                         'Converted','Lost')),
  notes              text,
  -- Leads are archived, never hard-deleted from the UI. NULL = active.
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null
                       default auth.uid(),
  updated_at         timestamptz not null default now()
);

comment on table  public.leads             is 'Enquiries and prospects. Archived via archived_at, never deleted.';
comment on column public.leads.phone_norm  is 'Digits only, generated. For search and dedupe.';
comment on column public.leads.archived_at is 'NULL = active. Set by archive, cleared by restore.';

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create index if not exists leads_status_idx      on public.leads (status);
create index if not exists leads_created_at_idx  on public.leads (created_at desc);
create index if not exists leads_phone_norm_idx  on public.leads (phone_norm);
-- Partial index for the default list, which always filters to active leads.
create index if not exists leads_active_idx      on public.leads (created_at desc)
  where archived_at is null;

alter table public.leads enable row level security;

drop policy if exists "leads: authenticated full access" on public.leads;
create policy "leads: authenticated full access"
  on public.leads for all
  to authenticated
  using (true) with check (true);


-- =====================================================================
-- 2. CUSTOMERS
-- =====================================================================

create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references public.leads(id) on delete set null,
  name        text not null check (length(btrim(name)) > 0),
  phone       text not null check (length(btrim(phone)) > 0),
  phone_norm  text generated always as
                (regexp_replace(phone, '\D', '', 'g')) stored,
  location    text,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
                default auth.uid(),
  updated_at  timestamptz not null default now()
);

comment on table public.customers is
  'Converted leads and manually added customers. Deduplicated by phone_norm.';

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- Duplicate prevention is enforced by the DATABASE, not by a client-side
-- check, which would race under concurrent submits.
create unique index if not exists customers_phone_norm_key
  on public.customers (phone_norm);

create index if not exists customers_lead_id_idx on public.customers (lead_id);

alter table public.customers enable row level security;

drop policy if exists "customers: authenticated full access" on public.customers;
create policy "customers: authenticated full access"
  on public.customers for all
  to authenticated
  using (true) with check (true);


-- =====================================================================
-- 3. FOLLOWUPS
-- =====================================================================

create table if not exists public.followups (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references public.leads(id)     on delete cascade,
  customer_id  uuid references public.customers(id) on delete cascade,
  scheduled_at timestamptz not null,
  note         text,
  status       text not null default 'Pending'
                 check (status in ('Pending','Completed','Cancelled')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null
                 default auth.uid(),
  updated_at   timestamptz not null default now(),
  -- A follow-up without a parent is meaningless.
  constraint followups_has_parent
    check (lead_id is not null or customer_id is not null)
);

comment on table public.followups is
  'Scheduled follow-ups against a lead or a customer. Must have one parent.';

drop trigger if exists followups_set_updated_at on public.followups;
create trigger followups_set_updated_at
  before update on public.followups
  for each row execute function public.set_updated_at();

-- Serves the today / overdue / upcoming queries.
create index if not exists followups_status_scheduled_idx
  on public.followups (status, scheduled_at);
create index if not exists followups_lead_id_idx     on public.followups (lead_id);
create index if not exists followups_customer_id_idx on public.followups (customer_id);

alter table public.followups enable row level security;

drop policy if exists "followups: authenticated full access" on public.followups;
create policy "followups: authenticated full access"
  on public.followups for all
  to authenticated
  using (true) with check (true);


-- =====================================================================
-- 4. ORDERS
-- =====================================================================

create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  -- RESTRICT: an order must never lose its customer. Revenue history is
  -- protected even against a delete run in the Supabase dashboard.
  customer_id  uuid not null references public.customers(id) on delete restrict,
  lead_id      uuid references public.leads(id) on delete set null,
  order_date   date not null default (now() at time zone 'Asia/Kolkata')::date,
  description  text,
  quantity     numeric(12,2) check (quantity is null or quantity > 0),
  unit         text,
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  amount_paid  numeric(12,2) not null default 0 check (amount_paid  >= 0),
  -- Outstanding amount. Single definition; never recomputed in JavaScript.
  -- No upper bound on amount_paid: advances and overpayments are allowed,
  -- so balance may be negative (open question O2, default applied).
  balance      numeric(12,2) generated always as
                 (total_amount - amount_paid) stored,
  status       text not null default 'Pending'
                 check (status in ('Pending','Confirmed','Delivered','Cancelled')),
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null
                 default auth.uid(),
  updated_at   timestamptz not null default now()
);

comment on table  public.orders         is 'Customer orders and revenue.';
comment on column public.orders.balance is 'Generated: total_amount - amount_paid. May be negative on overpayment.';

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_order_date_idx  on public.orders (order_date desc);

alter table public.orders enable row level security;

drop policy if exists "orders: authenticated full access" on public.orders;
create policy "orders: authenticated full access"
  on public.orders for all
  to authenticated
  using (true) with check (true);


-- =====================================================================
-- 5. LOCK OUT THE anon ROLE
-- =====================================================================
-- RLS with no anon policy already denies everything. This revoke is
-- belt-and-braces: it removes the table grants Supabase gives anon by
-- default, so a future policy added carelessly cannot expose data.

revoke all on public.leads     from anon;
revoke all on public.customers from anon;
revoke all on public.followups from anon;
revoke all on public.orders    from anon;

-- Authenticated users need the grants; RLS policies above do the gating.
grant select, insert, update, delete
  on public.leads, public.customers, public.followups, public.orders
  to authenticated;


-- =====================================================================
-- 6. VERIFICATION
-- =====================================================================
-- Run these after applying. Both must return what the comment says.

-- 6a. Every table must show rowsecurity = true.
--
-- select tablename, rowsecurity
--   from pg_tables
--  where schemaname = 'public'
--    and tablename in ('leads','customers','followups','orders');

-- 6b. Exactly one policy per table, for the authenticated role.
--
-- select tablename, policyname, roles, cmd
--   from pg_policies
--  where schemaname = 'public'
--  order by tablename;

-- 6c. Generated columns and defaults behave as expected.
--     Run inside a transaction and roll back so no test data persists.
--
-- begin;
--   insert into public.leads (name, phone) values ('Test', '+91 98765-43210')
--     returning phone_norm, status, archived_at;   -- 919876543210 | New | null
--   insert into public.customers (name, phone) values ('Test', '098765 43210')
--     returning phone_norm;                        -- 09876543210
-- rollback;
--
-- RULE: the client's normalizePhone() helper runs BEFORE every insert and
-- update, so `phone` always stores the canonical 10-digit Indian mobile
-- number (no +91, no 0, no spaces). phone_norm is then identical to it.
-- The unique index on customers.phone_norm only prevents duplicates while
-- that rule holds: '9876543210' and '+919876543210' would otherwise be two
-- different normalised values and both would be accepted.

-- =====================================================================
-- End of schema.
-- =====================================================================
