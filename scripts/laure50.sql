-- Karaoké « Laure 50 ans » (/laure50) — état de lecture partagé + téléphones vus.
-- À exécuter une fois dans Supabase → SQL Editor.
-- RLS activée sans policy (deny-all) : accès uniquement via /api/laure50/* (service_role).

create table if not exists public.laure50_state (
  id int primary key default 1,
  playing boolean not null default false,
  pos double precision not null default 0,
  at bigint not null default 0,
  shift double precision not null default 0,
  rev int not null default 0,
  regie_key text, -- clé de la régie (jamais renvoyée aux téléphones)
  constraint laure50_state_single check (id = 1)
);
insert into public.laure50_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.laure50_phones (
  id text primary key,
  seen timestamptz not null default now()
);

alter table public.laure50_state enable row level security;
alter table public.laure50_phones enable row level security;

grant all on public.laure50_state, public.laure50_phones to service_role;
