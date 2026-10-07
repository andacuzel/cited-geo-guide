-- =====================================================================
-- Citehound Pro: database schema for Supabase (Postgres).
--
-- PREPARED, NOT APPLIED. Nothing in this repository reads it and no
-- Supabase project exists yet. Apply it by hand in a new project's SQL
-- editor once the decisions in local/pro-checklist.md are made.
--
-- Rule that runs through the file: a signed-in user reads only their own
-- rows. Users can never write entitlements, scans or pages. Those are
-- written by server code using the service-role key (the payment webhook
-- and the crawl pipeline), which bypasses row-level security by design.
-- The service-role key must never reach a browser.
-- =====================================================================

-- ---------------------------------------------------------------- profiles
-- One row per signed-in user. Nothing here beyond what auth.users has.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------ entitlements
-- What a user has paid for. One row per purchase. A one-time purchase has
-- no renewal: expires_at stays null unless the retention decision in the
-- checklist says an entitlement lapses.
create table public.entitlements (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  plan               text not null check (plan in ('pro')),
  source             text not null check (source in ('payment', 'manual')),
  external_reference text,                       -- the payment provider's order or charge id
  granted_at         timestamptz not null default now(),
  expires_at         timestamptz,
  unique (source, external_reference)
);
create index entitlements_user_idx on public.entitlements (user_id);

-- ------------------------------------------------------------------- sites
-- A domain a user tracks.
create table public.sites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  domain      text not null check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  created_at  timestamptz not null default now(),
  unique (user_id, domain)
);
create index sites_user_idx on public.sites (user_id);

-- ------------------------------------------------------------------- scans
-- One saved scan or full-site crawl of a site.
create table public.scans (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  site_id          uuid not null references public.sites (id) on delete cascade,
  kind             text not null check (kind in ('page', 'crawl')),
  crawl_job_id     text check (crawl_job_id ~ '^[a-f0-9]{32}$'),   -- the id in the crawl store
  score            integer check (score between 0 and 100),         -- site-wide average for a crawl
  homepage_score   integer check (homepage_score between 0 and 100),
  pages_scanned    integer,
  pages_failed     integer,
  summary          jsonb,                                           -- the crawl summary, as stored
  created_at       timestamptz not null default now()
);
create index scans_user_idx on public.scans (user_id, created_at desc);
create index scans_site_idx on public.scans (site_id, created_at desc);

-- ------------------------------------------------------------------- pages
-- Per-page results of a crawl. user_id repeats the scan's owner so the
-- row-level policy needs no join.
create table public.pages (
  id             uuid primary key default gen_random_uuid(),
  scan_id        uuid not null references public.scans (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  url            text not null,
  status         text not null check (status in ('ok', 'failed')),
  total          integer check (total between 0 and 100),
  discover       integer,
  tech           integer,
  trust          integer,
  failed_checks  jsonb,                                             -- [{label, pts, max, advice}]
  site_info      jsonb,                                             -- {title, metaDesc, lang}
  error          text
);
create index pages_scan_idx on public.pages (scan_id);
create index pages_user_idx on public.pages (user_id);

-- ------------------------------------------------- row-level security
alter table public.profiles     enable row level security;
alter table public.entitlements enable row level security;
alter table public.sites        enable row level security;
alter table public.scans        enable row level security;
alter table public.pages        enable row level security;

-- A user reads only their own rows.
create policy profiles_select_own     on public.profiles     for select to authenticated using (id = auth.uid());
create policy entitlements_select_own on public.entitlements for select to authenticated using (user_id = auth.uid());
create policy sites_select_own        on public.sites        for select to authenticated using (user_id = auth.uid());
create policy scans_select_own        on public.scans        for select to authenticated using (user_id = auth.uid());
create policy pages_select_own        on public.pages        for select to authenticated using (user_id = auth.uid());

-- A user may add, rename and remove their own sites, nothing else.
create policy sites_insert_own on public.sites for insert to authenticated with check (user_id = auth.uid());
create policy sites_update_own on public.sites for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sites_delete_own on public.sites for delete to authenticated using (user_id = auth.uid());

-- A user may remove their own saved scans (this cascades to pages). They cannot create or edit
-- them, so a scan on screen is always one the server wrote.
create policy scans_delete_own on public.scans for delete to authenticated using (user_id = auth.uid());

-- No insert, update or delete policy exists on profiles, entitlements or pages for the
-- authenticated or anon roles, so those writes are denied. The service role bypasses RLS.

-- ------------------------------------------------- helpers
-- True when the signed-in user holds a current Pro entitlement.
create or replace function public.has_pro()
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = auth.uid() and e.plan = 'pro' and (e.expires_at is null or e.expires_at > now())
  );
$$;

-- Creates a profile row when someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
