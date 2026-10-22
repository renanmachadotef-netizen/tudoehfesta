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
  ('jantares', 'Jantares', 3),
  ('esportes', 'Esportivos', 4),
  ('outros', 'Outros', 5)
on conflict (slug) do nothing;

insert into settings (key, value) values
  ('commission_pct', '15'),
  ('release_days', '3'),
  ('min_payout_cents', '5000'),
  ('site', '{"whatsapp": "5548984082628", "instagram": "tudoehfesta", "tagline": "Eternizando gerações!", "since": 2003, "pix_key": "", "pix_name": ""}')
on conflict (key) do nothing;

alter table orders add column if not exists coupon_code text;

-- v2: galeria oculta, marca d'agua por evento, importacao do Google Drive, processamento em segundo plano.
alter table events add column if not exists hide_gallery boolean not null default false;
alter table events add column if not exists watermark_mode text not null default 'site';
alter table events add column if not exists drive_folder_id text;
alter table events add column if not exists drive_source_id integer;
alter table events add column if not exists auto_publish boolean not null default false;
create unique index if not exists events_drive_folder_idx on events (drive_folder_id) where drive_folder_id is not null;

-- key: codigo aleatorio no nome do arquivo da vitrine (muda a cada nova renderizacao e impede adivinhar enderecos).
alter table photos add column if not exists key text;
alter table photos add column if not exists needs_render boolean not null default false;
alter table photos add column if not exists needs_faces boolean not null default false;
alter table photos add column if not exists drive_file_id text;
create unique index if not exists photos_drive_file_idx on photos (drive_file_id) where drive_file_id is not null;
create index if not exists photos_pending_idx on photos (id) where needs_render or needs_faces;

alter table photographers add column if not exists watermark jsonb;

create table if not exists drive_sources (
  id serial primary key,
  photographer_id integer not null references users(id) on delete cascade,
  folder_id text not null,
  name text,
  year integer not null,
  category_id integer references categories(id) on delete set null,
  price_cents integer not null default 1500,
  pack_price_cents integer,
  auto_publish boolean not null default true,
  hide_gallery boolean not null default false,
  watermark_mode text not null default 'site',
  active boolean not null default true,
  last_sync_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (photographer_id, folder_id)
);

-- Arquivos do Drive que a revisao automatica recusou (para nao baixar de novo a cada rodada).
create table if not exists drive_skips (
  drive_file_id text primary key,
  source_id integer not null references drive_sources(id) on delete cascade,
  name text,
  reason text not null,
  created_at timestamptz not null default now()
);

insert into settings (key, value) values
  ('watermark', '{"type": "text", "text": "tudoehfesta.com", "image": null, "opacity": 0.35, "layout": "tiled"}')
on conflict (key) do nothing;

-- v3: originais que ficam so no Drive (original_path = 'drive:<id>') e copia das fotos vendidas; InfinitePay.
alter table drive_sources add column if not exists keep_in_drive boolean not null default true;
alter table photos add column if not exists needs_copy boolean not null default false;
create index if not exists photos_copy_idx on photos (id) where needs_copy;
alter table orders add column if not exists payment_provider text;
alter table orders add column if not exists ip_slug text;
alter table orders add column if not exists ip_transaction_nsu text;
alter table orders add column if not exists checkout_url text;

-- v4: InfinitePay (comprovante, parcelas, verificacao periodica) e expiracao de pedidos pendentes.
alter table orders add column if not exists ip_checked_at timestamptz;
alter table orders add column if not exists ip_receipt_url text;
alter table orders add column if not exists installments integer;
alter table orders add column if not exists paid_amount_cents integer;
create index if not exists orders_pending_idx on orders (created_at) where status = 'pending';

-- v5: pasta do Drive ligada a um evento especifico (kind = 'event') alem da pasta do ano (kind = 'year').
alter table drive_sources add column if not exists kind text not null default 'year';
alter table drive_sources add column if not exists event_id integer references events(id) on delete cascade;
create unique index if not exists drive_sources_event_idx on drive_sources (event_id) where event_id is not null;

-- v6: pasta geral com varios anos (tudoehfesta/2003..2026/mes/evento): ano da fonte passa a ser opcional.
alter table drive_sources alter column year drop not null;

-- v7: acervo por ano, rosto do cliente (monitoramento) e "borrar minhas imagens".
-- events.kind: 'event' = evento cadastrado (aparece nas listas); 'pool' = acervo do ano, criado sozinho a partir
-- das pastas do Drive (so aparece na busca por ano/selfie). Ligar a pasta a um evento cadastrado migra as fotos.
alter table events add column if not exists kind text not null default 'event';
update events set kind = 'pool' where kind = 'event' and drive_source_id in (select id from drive_sources where kind = 'year');
create index if not exists events_kind_idx on events (kind, status);

-- Rosto cadastrado pelo cliente (so o vetor de 128 numeros; a selfie nao e guardada). Consentimento LGPD explicito.
create table if not exists user_faces (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  descriptor bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists user_faces_user_idx on user_faces (user_id);
alter table users add column if not exists face_consent_at timestamptz;
alter table users add column if not exists blur_me boolean not null default false;
alter table users add column if not exists needs_face_scan boolean not null default false;

-- Fotos em que o sistema encontrou o cliente (aparecem em "Minhas fotos -> Encontradas para voce").
create table if not exists user_matches (
  user_id integer not null references users(id) on delete cascade,
  photo_id integer not null references photos(id) on delete cascade,
  distance real not null,
  seen boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, photo_id)
);

-- Rosto borrado a pedido do proprio cliente: some das buscas por selfie e e borrado nas vitrines e downloads de terceiros.
alter table faces add column if not exists blurred_user_id integer references users(id) on delete set null;
create index if not exists faces_blurred_idx on faces (photo_id) where blurred_user_id is not null;

-- v8: marcador (tag) da pasta de origem em cada foto e caminho da pasta no evento, para puxar fotos do acervo.
alter table photos add column if not exists tag text;
alter table events add column if not exists drive_folder_path text;
create index if not exists photos_tag_idx on photos (tag) where tag is not null;

-- v9: foto oculta pelo fotografo/admin (sai de tudo que e publico, mas continua guardada e baixavel por quem ja comprou)
alter table photos add column if not exists hidden boolean not null default false;

-- v10: sinal de vida da sincronizacao (duas copias do servidor durante um deploy nao importam a mesma pasta)
alter table drive_sources add column if not exists sync_heartbeat timestamptz;

-- v11: retrato da pasta ligada na ultima leitura (pastas e fotos por ano, ja importadas x faltando)
alter table drive_sources add column if not exists scan jsonb;

-- v12: carrinho salvo de quem esta logado (segue a pessoa entre aparelhos e alimenta a recuperacao) e
-- acompanhamento de pedidos nao pagos (em aberto / em contato / perdido)
create table if not exists carts (
  user_id integer primary key references users(id) on delete cascade,
  photo_ids integer[] not null default '{}',
  token text not null unique,
  updated_at timestamptz not null default now(),
  recovery_status text not null default 'open',
  contacted_at timestamptz
);
alter table orders add column if not exists recovery_status text not null default 'open';
alter table orders add column if not exists contacted_at timestamptz;

-- v13: acesso ao evento (publico / so com o link / com senha), liberacao agendada e cupons com mais tipos
alter table events add column if not exists visibility text not null default 'public';
alter table events add column if not exists password_hash text;
alter table events add column if not exists publish_at timestamptz;
alter table coupons alter column pct drop not null;
alter table coupons drop constraint if exists coupons_pct_check;
alter table coupons add column if not exists kind text not null default 'pct';
alter table coupons add column if not exists amount_cents integer;
alter table coupons add column if not exists free_photos integer;
alter table coupons add column if not exists starts_at date;
alter table coupons add column if not exists ends_at date;
alter table coupons add column if not exists batch text;

-- v14: visitas (contador proprio, sem cookie): pagina, evento, aparelho e um identificador diario anonimo
create table if not exists visits (
  id bigserial primary key,
  at timestamptz not null default now(),
  event_id integer references events(id) on delete set null,
  page text not null,
  device text not null,
  visitor text not null
);
create index if not exists visits_at_idx on visits (at);
create index if not exists visits_event_idx on visits (event_id, at) where event_id is not null;

-- v15: hora em que a foto foi tirada (relogio da camera), para o filtro por horario na galeria do evento
alter table photos add column if not exists taken_at timestamp;
create index if not exists photos_event_taken_idx on photos (event_id, taken_at) where taken_at is not null;

-- v16: varios fotografos no mesmo evento. O dono do evento convida fotografos (equipe); cada foto continua
-- sendo de quem a tirou. Na venda de foto de convidado, o organizador fica com organizer_pct do valor.
create table if not exists event_team (
  event_id integer not null references events(id) on delete cascade,
  user_id integer not null references users(id) on delete cascade,
  max_photos integer,
  upload_until timestamptz,
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_team_user_idx on event_team (user_id);
alter table events add column if not exists organizer_pct integer not null default 0;
alter table order_items add column if not exists organizer_id integer references users(id);
alter table order_items add column if not exists organizer_cents integer not null default 0;

-- v17: protecao por desfoque da previa (so uma parte fica nitida) e busca por numero de peito
alter table events add column if not exists protect_mode text not null default 'none';
alter table events add column if not exists bib_search boolean not null default false;
alter table photos add column if not exists bib_done boolean not null default false;
create table if not exists photo_bibs (
  photo_id integer not null references photos(id) on delete cascade,
  event_id integer not null references events(id) on delete cascade,
  bib text not null,
  source text not null default 'ocr',
  primary key (photo_id, bib)
);
create index if not exists photo_bibs_event_idx on photo_bibs (event_id, bib);
