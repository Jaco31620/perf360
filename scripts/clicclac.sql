-- Clic-Clac (/clic-clac) — photo booth virtuel : albums, photos, config super-admin.
-- À exécuter une fois dans Supabase → SQL Editor.
-- RLS activée sans policy (deny-all) : accès uniquement via /api/clicclac/* (service_role).
-- Photos : bucket Storage PRIVÉ « clicclac » (liens signés temporaires).

create table if not exists public.clicclac_config (
  id int primary key default 1,
  master_hash text not null,           -- empreinte scrypt du mot de passe super-admin
  constraint clicclac_config_single check (id = 1)
);

create table if not exists public.clicclac_albums (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,           -- code invité (6 caractères)
  name text not null,
  event_date date,
  admin_hash text not null,            -- empreinte du code admin (PIN)
  admin_email text,
  settings jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  reminded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.clicclac_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.clicclac_albums(id) on delete cascade,
  path text not null,                  -- version standard (≈1600 px)
  thumb_path text not null,            -- miniature (≈480 px)
  hd_path text,                        -- version haute définition (option)
  guest_id text,
  guest_name text,
  caption text,
  kind text not null default 'photo',  -- photo | strip
  source text not null default 'guest',-- guest | booth
  status text not null default 'published', -- published | pending
  bytes int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists clicclac_photos_album_idx on public.clicclac_photos(album_id, created_at desc);
create index if not exists clicclac_photos_guest_idx on public.clicclac_photos(album_id, guest_id);

alter table public.clicclac_config enable row level security;
alter table public.clicclac_albums enable row level security;
alter table public.clicclac_photos enable row level security;
grant all on public.clicclac_config, public.clicclac_albums, public.clicclac_photos to service_role;

-- Mot de passe super-admin : seule son empreinte scrypt est stockée
-- (format « scrypt$<sel hex>$<hash hex> », hash = scrypt(mdp, sel, 64 octets)).
-- Elle est insérée hors dépôt (jamais commitée), par exemple :
--   insert into public.clicclac_config (id, master_hash) values (1, '<empreinte>')
--   on conflict (id) do update set master_hash = excluded.master_hash;
