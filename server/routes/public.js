import { Router } from 'express';
import { db } from '../db.js';
import { getSetting, priceCart } from '../pricing.js';
import { searchFaces, DIM, DEFAULT_THRESHOLD } from '../faces.js';
import { previewUrl, thumbUrl } from '../storage.js';
import { mpEnabled } from '../payments.js';
import { fail, rateLimit } from '../util.js';

const r = Router();

// Colunas comuns para cartoes de evento.
export const EVENT_CARD = `
  e.id, e.slug, e.title, e.event_date, e.city, e.venue, e.status, e.price_cents, e.pack_price_cents,
  e.discount_tiers, e.category_id, c.name as category_name, c.slug as category_slug, e.hide_gallery, e.watermark_mode,
  ph.display_name as photographer_name, ph.slug as photographer_slug, ph.avatar_path as photographer_avatar,
  (select count(*) from photos p where p.event_id = e.id and p.key is not null)::int as photo_count,
  cv.id as cover_id, cv.key as cover_key`;
// Capa: a escolhida pelo fotografo ou a primeira foto. Em evento com galeria oculta so a escolhida
// (uma foto qualquer poderia expor quem nao quer aparecer).
export const EVENT_JOINS = `
  from events e
  left join categories c on c.id = e.category_id
  left join photographers ph on ph.user_id = e.photographer_id
  left join lateral (
    select p.id, p.key from photos p
     where p.key is not null and p.id = coalesce(e.cover_photo_id,
       case when e.hide_gallery then null else (select min(p2.id) from photos p2 where p2.event_id = e.id and p2.key is not null) end)
  ) cv on true`;

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
         from categories c left join events e on e.category_id = c.id and e.status = 'published'
        group by c.id order by c.sort, c.name`,
    ),
    db.many(
      `select extract(year from event_date)::int as year, count(*)::int as events
         from events where status = 'published' group by 1 order by 1 desc`,
    ),
    db.one(
      `select (select count(*) from photos p join events e on e.id = p.event_id and e.status = 'published')::int as photos,
              (select count(*) from events where status = 'published')::int as events,
              (select count(*) from photographers where status = 'approved')::int as photographers`,
    ),
  ]);
  res.json({
    site: { ...site, pix_key: undefined },
    categories,
    years,
    totals,
    payments: { mercadopago: mpEnabled() },
    commission_pct: Number(await getSetting('commission_pct', 15)),
    user: req.user,
  });
});

r.get('/events', async (req, res) => {
  const where = [`e.status = 'published'`];
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
  res.json({ events: rows.slice(0, limit).map(eventCard), more: rows.length > limit });
});

r.get('/events/:slug', async (req, res) => {
  const row = await db.one(
    `select ${EVENT_CARD}, e.description, e.photographer_id, ph.instagram as photographer_instagram,
            (select count(*) from faces f where f.event_id = e.id)::int as face_count
       ${EVENT_JOINS} where e.slug = $1`,
    [req.params.slug],
  );
  const canSee = row && (row.status === 'published' || req.user?.role === 'admin' || req.user?.id === row.photographer_id);
  if (!canSee) fail(404, 'Evento não encontrado.');
  db.query('update events set views = views + 1 where id = $1', [row.id]).catch(() => {});
  res.json({ event: eventCard(row) });
});

r.get('/events/:slug/photos', async (req, res) => {
  const ev = await db.one('select id, status, photographer_id, hide_gallery from events where slug = $1', [req.params.slug]);
  const owner = req.user?.role === 'admin' || req.user?.id === ev?.photographer_id;
  if (!ev || (ev.status !== 'published' && !owner)) fail(404, 'Evento não encontrado.');
  // Galeria oculta: as fotos so aparecem pela busca por selfie.
  if (ev.hide_gallery && !owner) return res.json({ photos: [], more: false, hidden: true });
  const limit = Math.min(Number(req.query.limit) || 120, 300);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = await db.many(
    `select id, event_id, width, height, key from photos where event_id = $1 and key is not null order by sort_key nulls last, id limit $2 offset $3`,
    [ev.id, limit + 1, offset],
  );
  res.json({ photos: rows.slice(0, limit).map(photoOut), more: rows.length > limit });
});

r.get('/photos', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 500);
  if (!ids.length) return res.json({ photos: [] });
  const rows = await db.many(
    `select p.id, p.event_id, p.width, p.height, p.key, e.title as event_title, e.slug as event_slug, e.price_cents
       from photos p join events e on e.id = p.event_id and e.status = 'published' and not e.hide_gallery
      where p.id = any($1::int[]) and p.key is not null`,
    [ids],
  );
  res.json({ photos: rows.map((p) => ({ ...photoOut(p), event_title: p.event_title, event_slug: p.event_slug, price_cents: p.price_cents })) });
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
    const ev = await db.one(`select id from events where slug = $1 and status = 'published'`, [String(event)]);
    if (!ev) fail(404, 'Evento não encontrado.');
    key = `event:${ev.id}`;
  }
  const threshold = Math.min(Math.max(Number(req.body.threshold) || DEFAULT_THRESHOLD, 0.35), 0.6);
  const hits = await searchFaces(descriptors, key, threshold);
  if (!hits.length) return res.json({ photos: [], events: [] });
  const ids = hits.map((h) => h.photoId);
  const rows = await db.many(
    `select p.id, p.event_id, p.width, p.height, p.key from photos p join events e on e.id = p.event_id and e.status = 'published'
      where p.id = any($1::int[]) and p.key is not null`,
    [ids],
  );
  const byId = new Map(rows.map((p) => [p.id, p]));
  const photos = hits.filter((h) => byId.has(h.photoId)).map((h) => ({ ...photoOut(byId.get(h.photoId)), distance: Number(h.distance.toFixed(3)) }));
  const eventIds = [...new Set(photos.map((p) => p.event_id))];
  const events = (await db.many(`select ${EVENT_CARD} ${EVENT_JOINS} where e.id = any($1::int[]) order by e.event_date desc`, [eventIds])).map(eventCard);
  res.json({ photos, events });
});

r.get('/photographers', async (_req, res) => {
  const rows = await db.many(
    `select ph.slug, ph.display_name, ph.city, ph.instagram, ph.avatar_path, ph.bio,
            (select count(*) from events e where e.photographer_id = ph.user_id and e.status = 'published')::int as events,
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
    `select ${EVENT_CARD} ${EVENT_JOINS} where e.photographer_id = $1 and e.status = 'published' order by e.event_date desc limit 60`,
    [ph.user_id],
  )).map(eventCard);
  const { user_id: _omit, ...pub } = ph;
  res.json({ photographer: pub, events });
});

r.post('/cart/price', async (req, res) => {
  res.json(await priceCart(req.body?.photoIds, req.body?.coupon));
});

export default r;
