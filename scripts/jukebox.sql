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

-- v10 (31/10/2026) : blind test.
-- Titres de la mémoire utilisables en blind test automatique.
alter table public.jukebox_songs
  add column if not exists blind boolean not null default false;
-- Réponses des invités (une ligne par invité et par titre).
create table if not exists public.jukebox_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.jukebox_sessions(id)
    on delete cascade,
  track_id uuid not null,
  participant_id text not null,
  author text not null,
  artist_ok boolean not null default false,
  title_ok boolean not null default false,
  points int not null default 0,
  attempts int not null default 0,
  last_answer text,
  created_at timestamptz not null default now(),
  unique (track_id, participant_id)
);
create index if not exists jukebox_answers_session_idx
  on public.jukebox_answers(session_id);
alter table public.jukebox_answers enable row level security;
grant all on public.jukebox_answers to service_role;

-- v11 (31/10/2026) : vidéo disparue d'un titre validé / blind test
-- (gardé « à remplacer » au lieu d'être oublié).
alter table public.jukebox_songs
  add column if not exists missing boolean not null default false;

-- v12 (31/10/2026) : enrichissement de la mémoire (filtres du blind test).
-- Année de première sortie, langue des paroles, pays de l'artiste,
-- chanson française ou non (null : inconnu), date d'enrichissement.
alter table public.jukebox_songs
  add column if not exists year int;
alter table public.jukebox_songs
  add column if not exists lang text;
alter table public.jukebox_songs
  add column if not exists country text;
alter table public.jukebox_songs
  add column if not exists fr boolean;
alter table public.jukebox_songs
  add column if not exists enriched_at timestamptz;

-- v13 (31/10/2026) : étiquette « avec paroles » (la vidéo retenue affiche
-- les paroles), devinée d'après le titre YouTube, corrigée en super-admin.
alter table public.jukebox_songs
  add column if not exists lyrics boolean not null default false;

-- v14 (31/10/2026) : priorités de la revue des titres. Nombre de
-- passages en soirée, popularité Deezer (rank, à l'enrichissement).
alter table public.jukebox_songs
  add column if not exists plays int not null default 0;
alter table public.jukebox_songs
  add column if not exists rank int;

-- v15 (31/10/2026) : blind test, tous les essais d'un invité pour un titre
-- ([{ a: réponse, artist, title }]), affichés en régie.
alter table public.jukebox_answers
  add column if not exists tries jsonb not null default '[]';

-- v16 (01/11/2026) : accès régie. Code régie à 6 chiffres par soirée
-- (avec blocage après 5 essais ratés) et un jeton par appareil.
alter table public.jukebox_sessions
  add column if not exists regie_code text;
alter table public.jukebox_sessions
  add column if not exists regie_fails int not null default 0;
alter table public.jukebox_sessions
  add column if not exists regie_locked_until timestamptz;
create table if not exists public.jukebox_devices (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.jukebox_sessions(id)
    on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists jukebox_devices_session_idx
  on public.jukebox_devices(session_id);
alter table public.jukebox_devices enable row level security;
grant all on public.jukebox_devices to service_role;

-- v17 (01/11/2026) : titre et chaîne d'origine de la vidéo YouTube retenue
-- (affichés en petit dans le super-admin sous le libellé Deezer).
alter table public.jukebox_songs
  add column if not exists video_title text;
alter table public.jukebox_songs
  add column if not exists video_channel text;
