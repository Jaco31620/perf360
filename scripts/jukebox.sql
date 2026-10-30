-- Jukebox (/jukebox) — tables.
-- À exécuter une fois dans Supabase → SQL Editor.
-- RLS activée sans policy (deny-all) : tous les accès
-- passent par les routes serveur /api/jukebox/*
-- (clé service_role), comme pour le nuage de mots.

create table if not exists public.jukebox_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  admin_hash text not null,
  status text not null default 'open',
  max_per_participant int not null default 3,
  created_at timestamptz not null default now()
);

create table if not exists public.jukebox_tracks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.jukebox_sessions(id)
    on delete cascade,
  video_id text not null,
  title text not null,
  channel text,
  thumb text,
  duration int,
  participant_id text not null,
  author text,
  status text not null default 'queued',
  position double precision not null,
  created_at timestamptz not null default now(),
  played_at timestamptz
);

create index if not exists jukebox_tracks_idx
  on public.jukebox_tracks(session_id, status, position);

-- Cache des recherches YouTube (quota limité).
create table if not exists public.jukebox_cache (
  q text primary key,
  results jsonb not null,
  created_at timestamptz not null default now()
);

-- Réglages (clé API YouTube si absente des variables d'env).
create table if not exists public.jukebox_config (
  key text primary key,
  value text not null
);

alter table public.jukebox_sessions enable row level security;
alter table public.jukebox_tracks enable row level security;
alter table public.jukebox_cache enable row level security;
alter table public.jukebox_config enable row level security;

grant all on public.jukebox_sessions to service_role;
grant all on public.jukebox_tracks to service_role;
grant all on public.jukebox_cache to service_role;
grant all on public.jukebox_config to service_role;

-- v2 (30/10/2026) : versions karaoké en priorité (choix de la régie).
alter table public.jukebox_sessions
  add column if not exists karaoke boolean not null default false;

-- v3 (30/10/2026) : options d'affichage (file sur l'écran / chez les invités).
alter table public.jukebox_sessions
  add column if not exists options jsonb not null default '{}'::jsonb;

-- v4 (30/10/2026) : position de lecture de la régie (écran synchronisé).
alter table public.jukebox_sessions
  add column if not exists playback jsonb;

-- v5 (30/10/2026) : ordres de la télécommande (pause, lecture, volume).
alter table public.jukebox_sessions
  add column if not exists command jsonb;

-- v6 (30/10/2026) : dédicaces.
alter table public.jukebox_tracks
  add column if not exists dedication text;

-- v7 (30/10/2026) : mémoire « titre Deezer → vidéo YouTube »,
-- revérifiée chaque nuit (règle YouTube des 30 jours).
create table if not exists public.jukebox_songs (
  key text primary key,
  video_id text not null,
  duration int,
  checked_at timestamptz not null default now()
);
create index if not exists jukebox_songs_checked_idx
  on public.jukebox_songs(checked_at);
alter table public.jukebox_songs enable row level security;
grant all on public.jukebox_songs to service_role;

-- v8 (30/10/2026) : libellé lisible des titres mémorisés (super-admin).
alter table public.jukebox_songs
  add column if not exists label text;

-- v9 (30/10/2026) : vidéos validées à la main (super-admin / régie).
alter table public.jukebox_songs
  add column if not exists validated boolean not null default false;
