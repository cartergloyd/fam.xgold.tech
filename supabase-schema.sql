-- Run once in Supabase: SQL Editor > New query > paste > Run
create table if not exists public.kv (
  coll text not null,
  id   text not null,
  data jsonb not null default '{}'::jsonb,
  primary key (coll, id)
);
alter table public.kv enable row level security;
drop policy if exists "family read"   on public.kv;
drop policy if exists "family write"  on public.kv;
drop policy if exists "family update" on public.kv;
drop policy if exists "family delete" on public.kv;
create policy "family read"   on public.kv for select to anon using (coll in ('plans','bedrooms','flights','members','progress','meals','groceries'));
create policy "family write"  on public.kv for insert to anon with check (coll in ('plans','bedrooms','flights','members','progress','meals','groceries'));
create policy "family update" on public.kv for update to anon using (coll in ('plans','bedrooms','flights','members','progress','meals','groceries')) with check (coll in ('plans','bedrooms','flights','members','progress','meals','groceries'));
create policy "family delete" on public.kv for delete to anon using (coll in ('plans','bedrooms','flights','members','progress','meals','groceries'));
alter publication supabase_realtime add table public.kv;
