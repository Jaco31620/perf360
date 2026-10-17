-- Nuage de mots (/nuage) — tables + fonction d'agrégation.
-- À exécuter une fois dans Supabase → SQL Editor.
-- RLS activée sans policy (deny-all) : tous les accès passent par les routes
-- serveur /api/nuage/* (clé service_role), comme pour le dispositif FFBB.

create table if not exists public.nuage_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  question text not null,
  admin_hash text not null,
  status text not null default 'open',
  max_per_participant int not null default 3,
  hidden jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.nuage_words (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.nuage_sessions(id) on delete cascade,
  word_key text not null,
  word text not null,
  participant_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists nuage_words_session_idx on public.nuage_words(session_id);
create index if not exists nuage_words_participant_idx on public.nuage_words(session_id, participant_id);

alter table public.nuage_sessions enable row level security;
alter table public.nuage_words enable row level security;

grant all on public.nuage_sessions, public.nuage_words to service_role;

-- Agrégat pour l'affichage : un objet par mot (clé, forme la plus fréquente,
-- nombre d'envois, premier envoi) + totaux.
create or replace function public.nuage_stats(sid uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'words', coalesce((
      select jsonb_agg(jsonb_build_object('k', word_key, 'w', w, 'n', n, 't', t) order by n desc, t asc)
      from (
        select word_key, mode() within group (order by word) as w, count(*) as n, min(created_at) as t
        from public.nuage_words where session_id = sid group by word_key
      ) s
    ), '[]'::jsonb),
    'total', (select count(*) from public.nuage_words where session_id = sid),
    'participants', (select count(distinct participant_id) from public.nuage_words where session_id = sid)
  );
$$;

revoke execute on function public.nuage_stats(uuid) from public, anon, authenticated;
grant execute on function public.nuage_stats(uuid) to service_role;

-- v2 (17/10/2026) : style d'affichage (palette + fond) choisi par le présentateur.
alter table public.nuage_sessions add column if not exists style jsonb not null default '{}'::jsonb;
