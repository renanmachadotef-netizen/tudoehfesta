-- Esquema idempotente: roda inteiro a cada inicializacao. Coluna nova => "alter table ... add column if not exists" no fim.
-- Valores em dinheiro sempre em centavos (integer).

create table if not exists users (
  id serial primary key,
  email text not null unique,
  name text not null,
  phone text,
  password_hash text not null,
  role text not null default 'customer' check (role in ('customer', 'photographer', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists photographers (
  user_id integer primary key references users(id) on delete cascade,
  slug text not null unique,
  display_name text not null,
  bio text,
  city text,
  instagram text,
  whatsapp text,
  camera text,
  pix_key text,
  pix_key_type text,
  avatar_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  commission_pct numeric(5,2),
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id serial primary key,
  slug text not null unique,
  name text not null,
  sort integer not null default 0
);

create table if not exists events (
  id serial primary key,
  slug text not null unique,
  title text not null,
  description text,
  category_id integer references categories(id) on delete set null,
  photographer_id integer not null references users(id),
  event_date date not null,
  city text,
  venue text,
  cover_photo_id integer,
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  price_cents integer not null default 1500,
  pack_price_cents integer,
  discount_tiers jsonb not null default '[]',
  views integer not null default 0,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists events_date_idx on events (event_date desc);
create index if not exists events_photographer_idx on events (photographer_id);

create table if not exists photos (
  id serial primary key,
  event_id integer not null references events(id) on delete cascade,
  photographer_id integer not null references users(id),
  original_name text,
  original_path text not null,
  width integer,
  height integer,
  bytes integer,
  sha256 text,
  faces_count integer not null default 0,
  sort_key text,
  created_at timestamptz not null default now()
);
create index if not exists photos_event_idx on photos (event_id, sort_key, id);
create unique index if not exists photos_event_sha_idx on photos (event_id, sha256);

-- Um vetor de 128 numeros (float32, 512 bytes) por rosto encontrado. Nada de foto do cliente fica guardado:
-- a selfie vira vetor no navegador e so o vetor viaja na busca.
create table if not exists faces (
  id serial primary key,
  photo_id integer not null references photos(id) on delete cascade,
  event_id integer not null references events(id) on delete cascade,
  year integer not null,
  descriptor bytea not null,
  box jsonb
);
create index if not exists faces_year_idx on faces (year);
create index if not exists faces_event_idx on faces (event_id);

create table if not exists orders (
  id serial primary key,
  code text not null unique,
  user_id integer not null references users(id),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  subtotal_cents integer not null,
  discount_cents integer not null default 0,
  total_cents integer not null,
  payment_method text,
  mp_payment_id text,
  mp_preference_id text,
  pix_qr text,
  pix_qr_base64 text,
  pix_expires_at timestamptz,
  buyer_name text,
  buyer_email text,
  buyer_cpf text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists orders_user_idx on orders (user_id, created_at desc);

create table if not exists order_items (
  id serial primary key,
  order_id integer not null references orders(id) on delete cascade,
  photo_id integer not null references photos(id),
  event_id integer not null references events(id),
  photographer_id integer not null references users(id),
  price_cents integer not null,
  commission_cents integer not null,
  photographer_cents integer not null
);
create index if not exists order_items_order_idx on order_items (order_id);
create index if not exists order_items_photographer_idx on order_items (photographer_id);

create table if not exists payouts (
  id serial primary key,
  photographer_id integer not null references users(id),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'requested' check (status in ('requested', 'paid', 'rejected')),
  pix_key text,
  note text,
  requested_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists coupons (
  id serial primary key,
  code text not null unique,
  photographer_id integer references users(id) on delete cascade,
  event_id integer references events(id) on delete cascade,
  pct integer not null check (pct between 1 and 100),
  max_uses integer,
  uses integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

insert into categories (slug, name, sort) values
  ('festas', 'Festas', 1),
  ('formaturas', 'Formaturas', 2),
  ('casamentos', 'Casamentos', 3),
  ('corridas', 'Corridas e caminhadas', 4),
  ('esportes', 'Esportes', 5),
  ('rodeios', 'Rodeios e tradicionalismo', 6),
  ('shows', 'Shows e baladas', 7),
  ('corporativos', 'Corporativos', 8),
  ('escolares', 'Escolares', 9),
  ('acervo', 'Acervo histórico', 10)
on conflict (slug) do nothing;

insert into settings (key, value) values
  ('commission_pct', '15'),
  ('release_days', '3'),
  ('min_payout_cents', '5000'),
  ('site', '{"whatsapp": "5548984082628", "instagram": "tudoehfesta", "tagline": "Eternizando gerações!", "since": 2003, "pix_key": "", "pix_name": ""}')
on conflict (key) do nothing;

alter table orders add column if not exists coupon_code text;
