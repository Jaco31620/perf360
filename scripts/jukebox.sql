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
alter table public.jukebox_tracks
  add column if not exists video_title text;

-- v18 (01/11/2026) : gestion de la mémoire. Texte corrigé à la main
-- (interprète, titre), durée du titre Deezer (vidéos suspectes),
-- doublons fusionnés (alias vers la ligne gardée), date d'ajout.
alter table public.jukebox_songs
  add column if not exists artist_fix text;
alter table public.jukebox_songs
  add column if not exists title_fix text;
alter table public.jukebox_songs
  add column if not exists song_duration int;
alter table public.jukebox_songs
  add column if not exists merged_into text;
alter table public.jukebox_songs
  add column if not exists created_at timestamptz;
update public.jukebox_songs
  set created_at = checked_at
  where created_at is null;
alter table public.jukebox_songs
  alter column created_at set default now();

-- v19 (01/11/2026) : codes d'activation individuels (mode de création
-- « Avec un code »). Un code par organisateur : nombre de soirées
-- (null = illimité), expiration, désactivation, fonctions des soirées
-- créées avec ce code. Les soirées gardent le lien vers leur code dans
-- options (organizer, activationId) : pas de colonne à ajouter.
create table if not exists public.jukebox_activations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  max_parties int,
  used int not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  features jsonb,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.jukebox_activations enable row level security;
grant all on public.jukebox_activations to service_role;

-- v20 (01/11/2026) : rognage des vidéos (habillage au début ou à la fin :
-- intro, logo, scène parlée…). Par vidéo YouTube : la partie gardée va de
-- start_at à end_at (secondes, end_at null = jusqu'au bout). source :
-- manual (réglé à la main) ou sponsorblock (suggestion acceptée).
create table if not exists public.jukebox_trims (
  video_id text primary key,
  start_at real not null default 0,
  end_at real,
  source text not null default 'manual',
  updated_at timestamptz not null default now()
);
alter table public.jukebox_trims enable row level security;
grant all on public.jukebox_trims to service_role;

-- v21 (01/11/2026) : historique des changements de vidéo d'un titre de la
-- mémoire. « Mauvaise vidéo ? » en soirée : sur un titre validé par le
-- super-admin, le changement est seulement PROPOSÉ (status proposed) ;
-- sinon il est appliqué (applied), avec la trace de qui l'a fait et quand.
-- Le super-admin adopte / refuse les propositions, ou revient en arrière.
create table if not exists public.jukebox_video_changes (
  id uuid primary key default gen_random_uuid(),
  song_key text not null,
  old_video text,
  new_video text not null,
  new_title text,
  new_channel text,
  new_duration int,
  status text not null default 'applied',
  by_super boolean not null default false,
  session_code text,
  session_name text,
  organizer text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists jukebox_video_changes_key_idx
  on public.jukebox_video_changes(song_key);
create index if not exists jukebox_video_changes_status_idx
  on public.jukebox_video_changes(status);
alter table public.jukebox_video_changes enable row level security;
grant all on public.jukebox_video_changes to service_role;

-- v22 (01/11/2026) : audit. Compteur atomique pour limiter les abus
-- (essais du code régie, ajouts / recherches qui consomment le quota
-- YouTube, connexion super-admin) : jukebox_hit(clé, fenêtre en s) renvoie
-- le nombre d'appels dans la fenêtre en cours. + index manquants.
create table if not exists public.jukebox_rate (
  k text primary key,
  n int not null default 0,
  until timestamptz not null
);
alter table public.jukebox_rate enable row level security;
grant all on public.jukebox_rate to service_role;

create or replace function public.jukebox_hit(p_key text, p_window_s int)
returns int language sql security definer set search_path = public as $$
  insert into public.jukebox_rate as r (k, n, until)
  values (p_key, 1, now() + make_interval(secs => p_window_s))
  on conflict (k) do update set
    n = case when r.until < now() then 1 else r.n + 1 end,
    until = case when r.until < now() then now() + make_interval(secs => p_window_s) else r.until end
  returning n;
$$;
revoke all on function public.jukebox_hit(text, int) from public, anon, authenticated;
grant execute on function public.jukebox_hit(text, int) to service_role;

create index if not exists jukebox_songs_video_idx on public.jukebox_songs(video_id);
create index if not exists jukebox_cache_created_idx on public.jukebox_cache(created_at);
create index if not exists jukebox_answers_session_idx on public.jukebox_answers(session_id);

-- v23 (01/11/2026) : demandes d'accès (formulaire de /jukebox). Chaque
-- demande attend la validation du super-admin (onglet Demandes) ; validée,
-- elle crée un code d'activation envoyé par e-mail au demandeur.
-- status : pending | approved | rejected.
create table if not exists public.jukebox_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  event_date text,
  guests text,
  message text,
  status text not null default 'pending',
  activation_id uuid,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
alter table public.jukebox_requests enable row level security;
grant all on public.jukebox_requests to service_role;

-- v24 (01/11/2026) : durée d'utilisation des soirées créées avec un code
-- d'activation (jours à partir de la création, null = sans limite), héritée
-- par ces soirées (options.validDays). Le nom de colonne est historique.
alter table public.jukebox_activations
  add column if not exists retention_days int;

-- v25 (02/11/2026) : e-mail du demandeur gardé sur son code d'activation
-- (demande validée) : renvoi du code, accès envoyés à la création d'une
-- soirée, recherche d'un client par e-mail.
alter table public.jukebox_activations
  add column if not exists email text;
