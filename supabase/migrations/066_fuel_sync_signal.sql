-- One-row signal the fuel sync touches after a successful refresh, so an
-- open dashboard can hear "the sheet changed" as a single Realtime event.
--
-- WHY NOT SUBSCRIBE TO fuel_transactions DIRECTLY. The sync is an atomic
-- full-table replace: delete every row, insert every row, inside one
-- transaction. Realtime publishes one event per changed row, so a single
-- sync of a few thousand fills would put several thousand messages on
-- every open dashboard's socket for exactly one piece of information:
-- "refetch the aggregates". One UPDATE on this row says the same thing
-- in one small message, and the dashboard refetches the Postgres
-- aggregates it already reads, under its own RLS.
--
-- The route writes this with the service role (which bypasses RLS) as
-- part of every successful sync — including the 15-minute cron, so an
-- operator who leaves the dashboard open sees the backstop's refreshes
-- too, not only the Apps Script pushes.

create table if not exists public.fuel_sync_signals (
  id integer primary key default 1 check (id = 1),
  synced_at timestamptz not null default now(),
  synced_count integer
);

insert into public.fuel_sync_signals (id) values (1) on conflict (id) do nothing;

-- Readable by signed-in operators, same shape as fuel_transactions'
-- select policy: the dashboard subscribes as the signed-in user, and
-- Realtime applies RLS to what it publishes.
drop policy if exists "fuel_sync_signals_select" on public.fuel_sync_signals;
create policy "fuel_sync_signals_select" on public.fuel_sync_signals
  for select to authenticated using (true);

alter publication supabase_realtime add table public.fuel_sync_signals;
