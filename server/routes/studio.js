import fsp from 'node:fs/promises';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { requirePhotographer, requireUser } from '../auth.js';
import { dirs, storePhoto, photoSha, removePhotoFiles, storeAsset } from '../storage.js';
import { encodeDescriptor, invalidateFaces } from '../faces.js';
import { getSetting } from '../pricing.js';
import { EVENT_CARD, EVENT_JOINS, eventCard, photoOut } from './public.js';
import { fail, cleanText, toCents, uniqueSlug, photographerBalance } from '../util.js';

const r = Router();
const upload = multer({
  dest: dirs.tmp,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

// Perfil fica liberado mesmo com cadastro em analise (para completar dados e chave Pix).
r.get('/profile', requireUser, async (req, res) => {
  const p = await db.one('select * from photographers where user_id = $1', [req.user.id]);
  if (!p) fail(404, 'Cadastro de fotógrafo não encontrado.');
  res.json({ profile: p });
});

r.put('/profile', requireUser, async (req, res) => {
  const b = req.body || {};
  const p = await db.one('select user_id from photographers where user_id = $1', [req.user.id]);
  if (!p) fail(404, 'Cadastro de fotógrafo não encontrado.');
  await db.query(
    `update photographers set display_name = coalesce($2, display_name), bio = $3, city = $4, instagram = $5, whatsapp = $6,
       camera = $7, pix_key = $8, pix_key_type = $9 where user_id = $1`,
    [req.user.id, cleanText(b.display_name, 80), cleanText(b.bio, 600), cleanText(b.city, 80),
      cleanText(String(b.instagram || '').replace(/^@/, ''), 60), cleanText(b.whatsapp, 30), cleanText(b.camera, 80),
      cleanText(b.pix_key, 140), cleanText(b.pix_key_type, 20)],
  );
  res.json({ ok: true });
});

r.post('/profile/avatar', requireUser, upload.single('file'), async (req, res) => {
  if (!req.file) fail(400, 'Envie uma imagem JPG, PNG ou WEBP.');
  const url = await storeAsset(req.file.path, 'avatars', { square: true, maxSide: 400 });
  await db.query('update photographers set avatar_path = $2 where user_id = $1', [req.user.id, url]);
  res.json({ url });
});

r.use(requirePhotographer);

async function ownEvent(req, id) {
  const ev = await db.one('select * from events where id = $1', [Number(id)]);
  if (!ev || (ev.photographer_id !== req.user.id && req.user.role !== 'admin')) fail(404, 'Evento não encontrado.');
  return ev;
}

r.get('/dashboard', async (req, res) => {
  const uid = req.user.id;
  const [totals, series, topEvents, recent, balance, counts] = await Promise.all([
    db.one(
      `select
         coalesce(sum(oi.photographer_cents) filter (where o.paid_at >= date_trunc('day', now())), 0)::int8 as today,
         coalesce(sum(oi.photographer_cents) filter (where o.paid_at >= now() - interval '7 days'), 0)::int8 as week,
         coalesce(sum(oi.photographer_cents) filter (where o.paid_at >= date_trunc('month', now())), 0)::int8 as month,
         count(oi.id) filter (where o.paid_at >= date_trunc('month', now()))::int as photos_month,
         count(distinct o.user_id) filter (where o.paid_at >= date_trunc('month', now()))::int as buyers_month
       from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where oi.photographer_id = $1`,
      [uid],
    ),
    db.many(
      `select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(oi.photographer_cents), 0)::int8 as cents, count(oi.id)::int as photos
         from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
         left join orders o on o.status = 'paid' and date_trunc('day', o.paid_at) = d
         left join order_items oi on oi.order_id = o.id and oi.photographer_id = $1
        group by d order by d`,
      [uid],
    ),
    db.many(
      `select e.id, e.title, e.slug, e.views, coalesce(s.photos_sold, 0)::int as photos_sold, coalesce(s.cents, 0)::int8 as cents,
              coalesce(s.buyers, 0)::int as buyers
         from events e
         left join (select oi.event_id, count(*) as photos_sold, sum(oi.photographer_cents) as cents, count(distinct o.user_id) as buyers
                      from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' group by oi.event_id) s on s.event_id = e.id
        where e.photographer_id = $1 order by cents desc, e.event_date desc limit 8`,
      [uid],
    ),
    db.many(
      `select o.code, o.paid_at, u.name as buyer, count(oi.id)::int as photos, sum(oi.photographer_cents)::int8 as cents, min(e.title) as event_title
         from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
         join users u on u.id = o.user_id join events e on e.id = oi.event_id
        where oi.photographer_id = $1 group by o.id, u.name order by o.paid_at desc limit 10`,
      [uid],
    ),
    photographerBalance(uid),
    db.one(
      `select (select count(*) from events where photographer_id = $1)::int as events,
              (select count(*) from photos where photographer_id = $1)::int as photos,
              (select coalesce(sum(views), 0) from events where photographer_id = $1)::int8 as views`,
      [uid],
    ),
  ]);
  res.json({ totals, series, topEvents, recent, balance, counts });
});

r.get('/events', async (req, res) => {
  const mine = req.user.role === 'admin' && req.query.all ? '' : 'where e.photographer_id = $1';
  const rows = await db.many(
    `select ${EVENT_CARD}, e.views,
            (select count(*) from faces f where f.event_id = e.id)::int as face_count,
            (select coalesce(sum(oi.photographer_cents), 0) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
              where oi.event_id = e.id)::int8 as revenue_cents
       ${EVENT_JOINS} ${mine} order by e.event_date desc, e.id desc`,
    mine ? [req.user.id] : [],
  );
  res.json({ events: rows.map(eventCard) });
});

function eventFields(b) {
  const tiers = (Array.isArray(b.discount_tiers) ? b.discount_tiers : [])
    .map((t) => ({ min: Math.max(2, Math.round(Number(t.min))), pct: Math.min(90, Math.max(1, Math.round(Number(t.pct)))) }))
    .filter((t) => Number.isFinite(t.min) && Number.isFinite(t.pct))
    .sort((a, b2) => a.min - b2.min)
    .slice(0, 6);
  const price = toCents(b.price);
  if (price == null || price < 100) fail(400, 'Preço por foto mínimo: R$ 1,00.');
  const date = String(b.event_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Informe a data do evento.');
  if (!cleanText(b.title, 140)) fail(400, 'Informe o nome do evento.');
  return {
    title: cleanText(b.title, 140),
    description: cleanText(b.description, 2000),
    category_id: Number(b.category_id) || null,
    event_date: date,
    city: cleanText(b.city, 80),
    venue: cleanText(b.venue, 120),
    price_cents: price,
    pack_price_cents: toCents(b.pack_price) || null,
    discount_tiers: JSON.stringify(tiers),
    status: ['draft', 'published', 'hidden'].includes(b.status) ? b.status : 'draft',
  };
}

r.post('/events', async (req, res) => {
  const f = eventFields(req.body || {});
  const slug = await uniqueSlug('events', `${f.title} ${f.event_date.slice(0, 4)}`);
  const ev = await db.one(
    `insert into events (slug, title, description, category_id, photographer_id, event_date, city, venue, price_cents,
       pack_price_cents, discount_tiers, status, published_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, case when $12 = 'published' then now() end) returning id, slug`,
    [slug, f.title, f.description, f.category_id, req.user.id, f.event_date, f.city, f.venue, f.price_cents,
      f.pack_price_cents, f.discount_tiers, f.status],
  );
  res.json({ event: ev });
});

r.get('/events/:id', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const row = await db.one(
    `select ${EVENT_CARD}, e.description, e.views, e.cover_photo_id,
            (select count(*) from faces f where f.event_id = e.id)::int as face_count ${EVENT_JOINS} where e.id = $1`,
    [ev.id],
  );
  res.json({ event: eventCard(row) });
});

r.put('/events/:id', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const f = eventFields(req.body || {});
  const slug = f.title !== ev.title ? await uniqueSlug('events', `${f.title} ${f.event_date.slice(0, 4)}`, ev.id) : ev.slug;
  await db.query(
    `update events set slug = $2, title = $3, description = $4, category_id = $5, event_date = $6, city = $7, venue = $8,
       price_cents = $9, pack_price_cents = $10, discount_tiers = $11::jsonb, status = $12,
       published_at = case when $12 = 'published' then coalesce(published_at, now()) else published_at end
     where id = $1`,
    [ev.id, slug, f.title, f.description, f.category_id, f.event_date, f.city, f.venue, f.price_cents, f.pack_price_cents,
      f.discount_tiers, f.status],
  );
  if (String(ev.event_date) !== f.event_date) {
    await db.query('update faces set year = $2 where event_id = $1', [ev.id, Number(f.event_date.slice(0, 4))]);
  }
  invalidateFaces();
  res.json({ ok: true, slug });
});

r.delete('/events/:id', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const sold = await db.one('select count(*)::int as n from order_items where event_id = $1', [ev.id]);
  if (sold.n) fail(409, 'Este evento já tem vendas: oculte-o em vez de excluir.');
  const photos = await db.many('select id, original_path from photos where event_id = $1', [ev.id]);
  await db.query('delete from events where id = $1', [ev.id]);
  for (const p of photos) await removePhotoFiles(ev.id, p.id, p.original_path);
  invalidateFaces();
  res.json({ ok: true });
});

r.put('/events/:id/cover', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const p = await db.one('select id from photos where id = $1 and event_id = $2', [Number(req.body?.photoId), ev.id]);
  if (!p) fail(404, 'Foto não encontrada.');
  await db.query('update events set cover_photo_id = $2 where id = $1', [ev.id, p.id]);
  res.json({ ok: true });
});

r.get('/events/:id/photos', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const rows = await db.many(
    `select p.id, p.event_id, p.width, p.height, p.faces_count, p.original_name,
            (select count(*) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where oi.photo_id = p.id)::int as sold
       from photos p where p.event_id = $1 order by p.sort_key nulls last, p.id`,
    [ev.id],
  );
  res.json({ photos: rows.map((p) => ({ ...photoOut(p), faces: p.faces_count, name: p.original_name, sold: p.sold })) });
});

// Upload de uma foto por requisicao (o navegador manda varias em paralelo). Os rostos chegam ja
// calculados pelo navegador do fotografo: o servidor so guarda os vetores.
r.post('/events/:id/photos', upload.single('file'), async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  if (!req.file) fail(400, 'Arquivo inválido: envie JPG, PNG ou WEBP.');
  const tmp = req.file.path;
  try {
    const sha = await photoSha(tmp);
    const dup = await db.one('select id from photos where event_id = $1 and sha256 = $2', [ev.id, sha]);
    if (dup) {
      await fsp.unlink(tmp).catch(() => {});
      return res.json({ duplicate: true, id: dup.id });
    }
    let faces = [];
    try {
      faces = JSON.parse(req.body.faces || '[]');
    } catch {
      faces = [];
    }
    const name = cleanText(req.body.name || req.file.originalname, 200);
    const photo = await db.one(
      `insert into photos (event_id, photographer_id, original_name, original_path, sort_key) values ($1, $2, $3, '', $4) returning id`,
      [ev.id, ev.photographer_id, name, cleanText(req.body.sort_key || name, 200)],
    );
    const label = `${config.watermarkText}`;
    let stored;
    try {
      stored = await storePhoto({ tmpPath: tmp, eventId: ev.id, photoId: photo.id, originalName: name, label });
    } catch (err) {
      await db.query('delete from photos where id = $1', [photo.id]);
      throw err;
    }
    const year = Number(String(ev.event_date instanceof Date ? ev.event_date.toISOString() : ev.event_date).slice(0, 4));
    let saved = 0;
    for (const f of faces.slice(0, 60)) {
      const buf = encodeDescriptor(f.d);
      if (!buf) continue;
      await db.query('insert into faces (photo_id, event_id, year, descriptor, box) values ($1, $2, $3, $4, $5::jsonb)', [
        photo.id, ev.id, year, buf, JSON.stringify(f.box || null),
      ]);
      saved++;
    }
    await db.query('update photos set original_path = $2, width = $3, height = $4, bytes = $5, sha256 = $6, faces_count = $7 where id = $1', [
      photo.id, stored.originalPath, stored.width, stored.height, stored.bytes, stored.sha256, saved,
    ]);
    if (saved) invalidateFaces();
    res.json({ photo: { ...photoOut({ id: photo.id, event_id: ev.id, width: stored.width, height: stored.height }), faces: saved } });
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
});

// Reprocessar rostos de fotos ja enviadas (ex.: upload feito sem reconhecimento).
r.put('/photos/:id/faces', async (req, res) => {
  const p = await db.one('select p.id, p.event_id, e.event_date, e.photographer_id from photos p join events e on e.id = p.event_id where p.id = $1', [Number(req.params.id)]);
  if (!p || (p.photographer_id !== req.user.id && req.user.role !== 'admin')) fail(404, 'Foto não encontrada.');
  const year = Number(String(p.event_date instanceof Date ? p.event_date.toISOString() : p.event_date).slice(0, 4));
  const faces = (req.body?.faces || []).slice(0, 60).map((f) => ({ buf: encodeDescriptor(f.d), box: f.box })).filter((f) => f.buf);
  await db.tx(async (t) => {
    await t.query('delete from faces where photo_id = $1', [p.id]);
    for (const f of faces) {
      await t.query('insert into faces (photo_id, event_id, year, descriptor, box) values ($1, $2, $3, $4, $5::jsonb)', [p.id, p.event_id, year, f.buf, JSON.stringify(f.box || null)]);
    }
    await t.query('update photos set faces_count = $2 where id = $1', [p.id, faces.length]);
  });
  invalidateFaces();
  res.json({ ok: true, faces: faces.length });
});

r.delete('/photos/:id', async (req, res) => {
  const p = await db.one('select p.*, e.photographer_id as owner from photos p join events e on e.id = p.event_id where p.id = $1', [Number(req.params.id)]);
  if (!p || (p.owner !== req.user.id && req.user.role !== 'admin')) fail(404, 'Foto não encontrada.');
  const sold = await db.one('select count(*)::int as n from order_items where photo_id = $1', [p.id]);
  if (sold.n) fail(409, 'Esta foto já foi vendida e precisa continuar disponível para o cliente.');
  await db.query('update events set cover_photo_id = null where cover_photo_id = $1', [p.id]);
  await db.query('delete from photos where id = $1', [p.id]);
  await removePhotoFiles(p.event_id, p.id, p.original_path);
  invalidateFaces();
  res.json({ ok: true });
});

r.get('/sales', async (req, res) => {
  const rows = await db.many(
    `select o.code, o.paid_at, u.name as buyer, e.title as event_title, e.slug as event_slug,
            count(oi.id)::int as photos, sum(oi.price_cents)::int8 as gross_cents, sum(oi.commission_cents)::int8 as commission_cents,
            sum(oi.photographer_cents)::int8 as net_cents
       from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
       join users u on u.id = o.user_id join events e on e.id = oi.event_id
      where oi.photographer_id = $1 and ($2::int is null or oi.event_id = $2)
      group by o.id, u.name, e.id order by o.paid_at desc limit 300`,
    [req.user.id, Number(req.query.event) || null],
  );
  res.json({ sales: rows });
});

r.get('/finance', async (req, res) => {
  const [balance, payouts, profile, minPayout] = await Promise.all([
    photographerBalance(req.user.id),
    db.many('select * from payouts where photographer_id = $1 order by requested_at desc limit 100', [req.user.id]),
    db.one('select pix_key, pix_key_type, commission_pct from photographers where user_id = $1', [req.user.id]),
    getSetting('min_payout_cents', 5000),
  ]);
  const globalPct = Number(await getSetting('commission_pct', 15));
  res.json({
    balance,
    payouts,
    pix_key: profile?.pix_key,
    pix_key_type: profile?.pix_key_type,
    commission_pct: profile?.commission_pct != null ? Number(profile.commission_pct) : globalPct,
    min_payout_cents: Number(minPayout),
  });
});

r.post('/payouts', async (req, res) => {
  const profile = await db.one('select pix_key from photographers where user_id = $1', [req.user.id]);
  if (!profile?.pix_key) fail(400, 'Cadastre sua chave Pix no perfil antes de pedir o saque.');
  const balance = await photographerBalance(req.user.id);
  const min = Number(await getSetting('min_payout_cents', 5000));
  const amount = toCents(req.body?.amount) ?? balance.available;
  if (amount < min) fail(400, `Saque mínimo: R$ ${(min / 100).toFixed(2).replace('.', ',')}.`);
  if (amount > balance.available) fail(400, 'Valor maior que o saldo disponível.');
  await db.query('insert into payouts (photographer_id, amount_cents, pix_key) values ($1, $2, $3)', [req.user.id, amount, profile.pix_key]);
  res.json({ ok: true });
});

r.get('/coupons', async (req, res) => {
  const rows = await db.many(
    `select c.*, e.title as event_title from coupons c left join events e on e.id = c.event_id
      where c.photographer_id = $1 order by c.created_at desc`,
    [req.user.id],
  );
  res.json({ coupons: rows });
});

r.post('/coupons', async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  if (code.length < 3) fail(400, 'Código do cupom: mínimo 3 letras/números.');
  const pct = Math.round(Number(b.pct));
  if (!(pct >= 1 && pct <= 100)) fail(400, 'Desconto entre 1% e 100%.');
  if (b.event_id) await ownEvent(req, b.event_id);
  const exists = await db.one('select id from coupons where upper(code) = $1', [code]);
  if (exists) fail(409, 'Já existe um cupom com esse código.');
  await db.query('insert into coupons (code, photographer_id, event_id, pct, max_uses) values ($1, $2, $3, $4, $5)', [
    code, req.user.id, Number(b.event_id) || null, pct, Number(b.max_uses) || null,
  ]);
  res.json({ ok: true });
});

r.put('/coupons/:id', async (req, res) => {
  await db.query('update coupons set active = $3 where id = $1 and photographer_id = $2', [Number(req.params.id), req.user.id, !!req.body?.active]);
  res.json({ ok: true });
});

export default r;
