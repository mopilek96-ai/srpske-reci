-- Общий прогресс для «Сербских карточек».
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить → Run.

create table if not exists public.progress (
  name    text primary key,
  cards   jsonb not null default '{}'::jsonb,
  days    jsonb not null default '{}'::jsonb,
  updated timestamptz not null default now()
);

alter table public.progress enable row level security;

-- Сайт открыт без логина, поэтому читать и писать прогресс может любой, у кого есть адрес сайта.
-- Для учебных карточек это нормально; личных данных тут нет.
drop policy if exists "progress open read" on public.progress;
drop policy if exists "progress open write" on public.progress;
drop policy if exists "progress open update" on public.progress;
create policy "progress open read"   on public.progress for select to anon using (true);
create policy "progress open write"  on public.progress for insert to anon with check (char_length(name) <= 40);
create policy "progress open update" on public.progress for update to anon using (true) with check (char_length(name) <= 40);

grant select, insert, update on public.progress to anon;
