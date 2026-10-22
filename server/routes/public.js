import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.js';
import { checkPassword } from '../auth.js';
import { config } from '../config.js';
import { getSetting, priceCart, effectivePrice } from '../pricing.js';
import { searchFaces, DIM, DEFAULT_THRESHOLD } from '../faces.js';
import { previewUrl, thumbUrl } from '../storage.js';
import { paymentOptions } from '../payments.js';
import { fail, rateLimit } from '../util.js';

const r = Router();

// Colunas comuns para cartoes de evento.
export const EVENT_CARD = `
  e.id, e.slug, e.title, e.event_date, e.city, e.venue, e.status, e.price_cents, e.pack_price_cents,
  e.discount_tiers, e.category_id, c.name as category_name, c.slug as category_slug, e.hide_gallery, e.watermark_mode, e.kind,
  e.visibility, e.publish_at,
  ph.display_name as photographer_name, ph.slug as photographer_slug, ph.avatar_path as photographer_avatar,
  (select count(*) from photos p where p.event_id = e.id and p.key is not null and not p.hidden)::int as photo_count,
  cv.id as cover_id, cv.key as cover_key`;
// Capa: a escolhida pelo fotografo ou a primeira foto. Em evento com galeria oculta so a escolhida
// (uma foto qualquer poderia expor quem nao quer aparecer).
export const EVENT_JOINS = `
  from events e
  left join categories c on c.id = e.category_id
  left join photographers ph on ph.user_id = e.photographer_id
  left join lateral (
    select p.id, p.key from photos p
     where p.key is not null and not p.hidden and p.id = coalesce(e.cover_photo_id,
       case when e.hide_gallery then null else (select min(p2.id) from photos p2 where p2.event_id = e.id and p2.key is not null and not p2.hidden) end)
  ) cv on true`;

// Cartao publico: preco que vale hoje (evento recente = preco do evento; antigo ou acervo = tabela do acervo).
export function publicCard(row) {
  const p = effectivePrice(row);
  return {
    ...eventCard(row), price_cents: p.price_cents, pack_price_cents: p.pack_price_cents, discount_tiers: p.discount_tiers,
    archived: p.archived,
  };
}

export function eventCard(row) {
  const { cover_id, cover_key, ...rest } = row;
  return {
    ...rest,
    cover: cover_id ? previewUrl(row.id, cover_id, cover_key) : null,
    cover_thumb: cover_id ? thumbUrl(row.id, cover_id, cover_key) : null,
  };
}

export const photoOut = (p) => ({
  id: p.id,
  event_id: p.event_id,
  w: p.width,
  h: p.height,
  thumb: thumbUrl(p.event_id, p.id, p.key),
  preview: previewUrl(p.event_id, p.id, p.key),
});

r.get('/site', async (req, res) => {
  const [site, categories, years, totals] = await Promise.all([
    getSetting('site', {}),
    db.many(
      `select c.id, c.slug, c.name, c.sort, count(e.id)::int as events
         from categories c left join events e on e.category_id = c.id and e.status = 'published' and e.kind = 'event' and e.visibility = 'public'
        group by c.id order by c.sort, c.name`,
    ),
    db.many(
      `select extract(year from e.event_date)::int as year, count(distinct e.id) filter (where e.kind = 'event' and e.visibility = 'public')::int as events,
              count(p.id)::int as photos
         from events e left join photos p on p.event_id = e.id and p.key is not null and not p.hidden
        where e.status = 'published' and e.visibility <> 'password' group by 1 having count(p.id) > 0 or count(distinct e.id) filter (where e.kind = 'event' and e.visibility = 'public') > 0
        order by 1 desc`,
    ),
    db.one(
      `select (select count(*) from photos p join events e on e.id = p.event_id and e.status = 'published' where not p.hidden)::int as photos,
              (select count(*) from events where status = 'published' and kind = 'event' and visibility = 'public')::int as events,
              (select count(*) from photographers where status = 'approved')::int as photographers`,
    ),
  ]);
  res.json({
    site: { ...site, pix_key: undefined },
    categories,
    years,
    totals,
    payments: await paymentOptions(),
    commission_pct: Number(await getSetting('commission_pct', 15)),
    user: req.user,
  });
});

r.get('/events', async (req, res) => {
  // So eventos cadastrados; o acervo do ano (kind 'pool') aparece na busca e na galeria do ano.
  const where = [`e.status = 'published'`, `e.kind = 'event'`, `e.visibility = 'public'`];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (req.query.category) add('c.slug = ?', String(req.query.category));
  if (req.query.year) add('extract(year from e.event_date) = ?', Number(req.query.year));
  if (req.query.photographer) add('ph.slug = ?', String(req.query.photographer));
  if (req.query.city) add('e.city ilike ?', `%${req.query.city}%`);
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    const i = params.length;
    where.push(`(e.title ilike $${i} or e.city ilike $${i} or e.venue ilike $${i} or ph.display_name ilike $${i})`);
  }
  const limit = Math.min(Number(req.query.limit) || 24, 60);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  params.push(limit + 1, offset);
  const rows = await db.many(
    `select ${EVENT_CARD} ${EVENT_JOINS} where ${where.join(' and ')}
      order by e.event_date desc, e.id desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  res.json({ events: rows.slice(0, limit).map(publicCard), more: rows.length > limit });
});

r.get('/events/:slug', async (req, res) => {
  const row = await db.one(
    `select ${EVENT_CARD}, e.description, e.photographer_id, ph.instagram as photographer_instagram,
            (select count(*) from faces f where f.event_id = e.id)::int as face_count
       ${EVENT_JOINS} where e.slug = $1`,
    [req.params.slug],
  );
  const owner = req.user?.role === 'admin' || req.user?.id === row?.photographer_id;
  // Acervo do ano nao tem pagina: as fotos dele so aparecem pela busca por selfie.
  const canSee = row && (owner || (row.status === 'published' && row.kind === 'event'));
  if (!canSee) fail(404, 'Evento não encontrado.');
  // Evento com senha: so titulo, data e local ate a pessoa digitar a senha.
  if (row.visibility === 'password' && !owner && !(await unlocked(req, row.id))) {
    const card = publicCard(row);
    return res.json({ event: { ...card, cover: null, cover_thumb: null, locked: true } });
  }
  db.query('update events set views = views + 1 where id = $1', [row.id]).catch(() => {});
  res.json({ event: publicCard(row) });
});

// Senha do evento: confere e grava um cookie assinado so para este evento (30 dias).
const unlockValue = (id, hash) => crypto.createHmac('sha256', config.sessionSecret).update(`${id}:${hash}`).digest('base64url');
async function unlocked(req, eventId) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)evk${eventId}=([^;]+)`));
  if (!m) return false;
  const ev = await db.one('select password_hash from events where id = $1', [eventId]);
  return !!ev?.password_hash && m[1] === unlockValue(eventId, ev.password_hash);
}
r.post('/events/:slug/unlock', rateLimit('unlock', 20, 60_000), async (req, res) => {
  const ev = await db.one(`select id, password_hash from events where slug = $1 and status = 'published' and visibility = 'password'`, [req.params.slug]);
  if (!ev || !ev.password_hash) fail(404, 'Evento não encontrado.');
  if (!(await checkPassword(String(req.body?.password || ''), ev.password_hash))) fail(403, 'Senha incorreta.');
  res.cookie(`evk${ev.id}`, unlockValue(ev.id, ev.password_hash), { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 864e5, path: '/' });
  res.json({ ok: true });
});

r.get('/events/:slug/photos', async (req, res) => {
  const ev = await db.one('select id, status, photographer_id, hide_gallery, kind, visibility from events where slug = $1', [req.params.slug]);
  const owner = req.user?.role === 'admin' || req.user?.id === ev?.photographer_id;
  if (!ev || (ev.status !== 'published' && !owner)) fail(404, 'Evento não encontrado.');
  // Galeria oculta: as fotos so aparecem pela busca por selfie. Vale tambem para o dono/admin nesta pagina
  // (ele ve exatamente o que o visitante ve; as fotos ficam no painel).
  if (ev.visibility === 'password' && !owner && !(await unlocked(req, ev.id))) return res.json({ photos: [], more: false, hidden: true, locked: true });
  if (ev.hide_gallery || ev.kind === 'pool') return res.json({ photos: [], more: false, hidden: true, owner });
  const limit = Math.min(Number(req.query.limit) || 120, 300);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = await db.many(
    `select id, event_id, width, height, key from photos where event_id = $1 and key is not null and not hidden order by sort_key nulls last, id limit $2 offset $3`,
    [ev.id, limit + 1, offset],
  );
  res.json({ photos: rows.slice(0, limit).map(photoOut), more: rows.length > limit });
});

r.get('/photos', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 500);
  if (!ids.length) return res.json({ photos: [] });
  const rows = await db.many(
    `select p.id, p.event_id, p.width, p.height, p.key, e.title as event_title, e.slug as event_slug, e.price_cents, e.kind, e.event_date, e.pack_price_cents
       from photos p join events e on e.id = p.event_id and e.status = 'published' and not e.hide_gallery and e.kind = 'event'
      where p.id = any($1::int[]) and p.key is not null and not p.hidden`,
    [ids],
  );
  res.json({ photos: rows.map((p) => ({ ...photoOut(p), event_title: p.event_title, event_slug: p.event_slug, price_cents: effectivePrice(p).price_cents })) });
});

// Busca facial. Recebe so os vetores calculados no navegador: a selfie nunca sai do aparelho.
r.post('/faces/search', rateLimit('faces', 40, 60_000), async (req, res) => {
  const descriptors = (req.body?.descriptors || []).slice(0, 3);
  if (!descriptors.length || descriptors.some((d) => !Array.isArray(d) || d.length !== DIM)) {
    fail(400, 'Não foi possível ler o rosto da selfie. Tente outra foto, de frente e com boa luz.');
  }
  const { scope = 'all', year, event } = req.body;
  let key = 'all';
  if (scope === 'year' && year) key = `year:${Number(year)}`;
  if (scope === 'event' && event) {
    const ev = await db.one(`select id, visibility from events where slug = $1 and status = 'published'`, [String(event)]);
    if (!ev) fail(404, 'Evento não encontrado.');
    if (ev.visibility === 'password' && !(await unlocked(req, ev.id))) fail(403, 'Digite a senha do evento primeiro.');
    key = `event:${ev.id}`;
  }
  const threshold = Math.min(Math.max(Number(req.body.threshold) || DEFAULT_THRESHOLD, 0.35), 0.6);
  const hits = await searchFaces(descriptors, key, threshold);
  if (!hits.length) return res.json({ photos: [], events: [] });
  const ids = hits.map((h) => h.photoId);
  const rows = await db.many(
    `select p.id, p.event_id, p.width, p.height, p.key from photos p join events e on e.id = p.event_id and e.status = 'published'
      where p.id = any($1::int[]) and p.key is not null and not p.hidden`,
    [ids],
  );
  const byId = new Map(rows.map((p) => [p.id, p]));
  const photos = hits.filter((h) => byId.has(h.photoId)).map((h) => ({ ...photoOut(byId.get(h.photoId)), distance: Number(h.distance.toFixed(3)) }));
  const eventIds = [...new Set(photos.map((p) => p.event_id))];
  const events = (await db.many(`select ${EVENT_CARD} ${EVENT_JOINS} where e.id = any($1::int[]) order by e.event_date desc`, [eventIds])).map(publicCard);
  res.json({ photos, events });
});

r.get('/photographers', async (_req, res) => {
  const rows = await db.many(
    `select ph.slug, ph.display_name, ph.city, ph.instagram, ph.avatar_path, ph.bio,
            (select count(*) from events e where e.photographer_id = ph.user_id and e.status = 'published' and e.kind = 'event')::int as events,
            (select count(*) from photos p join events e on e.id = p.event_id and e.status = 'published' where e.photographer_id = ph.user_id)::int as photos
       from photographers ph where ph.status = 'approved' order by photos desc, ph.display_name`,
  );
  res.json({ photographers: rows });
});

r.get('/photographers/:slug', async (req, res) => {
  const ph = await db.one(
    `select user_id, slug, display_name, city, instagram, whatsapp, avatar_path, bio from photographers
      where slug = $1 and status = 'approved'`,
    [req.params.slug],
  );
  if (!ph) fail(404, 'Fotógrafo não encontrado.');
  const events = (await db.many(
    `select ${EVENT_CARD} ${EVENT_JOINS} where e.photographer_id = $1 and e.status = 'published' and e.kind = 'event' order by e.event_date desc limit 60`,
    [ph.user_id],
  )).map(publicCard);
  const { user_id: _omit, ...pub } = ph;
  res.json({ photographer: pub, events });
});

// Link de recuperacao: devolve as fotos de um carrinho salvo ou de um pedido nao pago para refazer o carrinho.
async function restorePhotos(ids) {
  if (!ids?.length) return [];
  const rows = await db.many(
    `select p.id, p.event_id, p.width, p.height, p.key, e.title as event_title, e.slug as event_slug
       from photos p join events e on e.id = p.event_id and e.status = 'published'
      where p.id = any($1::int[]) and p.key is not null and not p.hidden`,
    [ids],
  );
  return rows.map((p) => ({ ...photoOut(p), event_title: p.event_title, event_slug: p.event_slug }));
}
r.get('/cart/restore/:token', async (req, res) => {
  const t = String(req.params.token);
  let ids = [];
  if (/^[A-Z0-9]{6,16}$/.test(t)) {
    const o = await db.one(`select id from orders where code = $1 and status in ('pending', 'cancelled')`, [t]);
    if (o) ids = (await db.many('select photo_id from order_items where order_id = $1', [o.id])).map((r) => r.photo_id);
  } else {
    const c = await db.one('select photo_ids from carts where token = $1', [t]);
    ids = c?.photo_ids || [];
  }
  res.json({ photos: await restorePhotos(ids) });
});

// Contador de visitas. Sem cookie e sem guardar IP: o visitante vira um codigo que muda todo dia
// (IP + navegador + dia + segredo), so para contar pessoas diferentes. Robos ficam de fora.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse/i;
r.post('/track', rateLimit('track', 120, 60_000), async (req, res) => {
  res.status(204).end();
  const ua = String(req.headers['user-agent'] || '');
  const path = String(req.body?.path || '').slice(0, 200);
  if (!path.startsWith('/') || BOT.test(ua) || /^\/(admin|painel)\b/.test(path)) return;
  const seg = path.split('/')[1] || '';
  const page = { '': 'inicio', evento: 'evento', ano: 'ano', buscar: 'selfie', eventos: 'eventos', categoria: 'eventos', carrinho: 'carrinho', pedido: 'pedido' }[seg] || 'outras';
  let eventId = null;
  if (seg === 'evento') eventId = (await db.one('select id from events where slug = $1', [path.split('/')[2] || '']).catch(() => null))?.id || null;
  const device = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'celular' : 'computador';
  const day = new Date().toISOString().slice(0, 10);
  const visitor = crypto.createHash('sha256').update(`${req.ip}|${ua}|${day}|${config.sessionSecret}`).digest('base64url').slice(0, 16);
  await db.query('insert into visits (event_id, page, device, visitor) values ($1, $2, $3, $4)', [eventId, page, device, visitor]).catch(() => {});
});

r.post('/cart/price', async (req, res) => {
  res.json(await priceCart(req.body?.photoIds, req.body?.coupon));
});

export default r;
