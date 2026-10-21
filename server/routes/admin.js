import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { requireAdmin, hashPassword } from '../auth.js';
import { getSetting, setSetting } from '../pricing.js';
import { markOrderPaid, mpEnabled, paymentOptions } from '../payments.js';
import { dirs, storeAsset, removePhotoFiles } from '../storage.js';
import { invalidateFaces } from '../faces.js';
import { normalizeWatermark, watermarkPreview, clearWatermarkCache } from '../watermark.js';
import { queueStatus } from '../jobs.js';
import { driveInfo } from '../drive.js';
import { EVENT_CARD, EVENT_JOINS, eventCard } from './public.js';
import { fail, cleanText, slugify, photographerBalance } from '../util.js';

const r = Router();
const upload = multer({ dest: dirs.tmp, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
r.use(requireAdmin);

r.get('/dashboard', async (_req, res) => {
  const [totals, series, pending, topPhotographers] = await Promise.all([
    db.one(
      `select
         coalesce(sum(total_cents) filter (where status = 'paid' and paid_at >= date_trunc('month', now())), 0)::int8 as gmv_month,
         coalesce(sum(total_cents) filter (where status = 'paid'), 0)::int8 as gmv_total,
         count(*) filter (where status = 'paid' and paid_at >= date_trunc('month', now()))::int as orders_month,
         count(*) filter (where status = 'pending' and created_at >= now() - interval '2 days')::int as orders_pending,
         (select coalesce(sum(oi.commission_cents), 0) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
           where o.paid_at >= date_trunc('month', now()))::int8 as commission_month,
         (select coalesce(sum(oi.commission_cents), 0) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid')::int8 as commission_total,
         (select count(*) from users where role = 'customer')::int as customers,
         (select count(*) from photos)::int as photos,
         (select count(*) from faces)::int as faces,
         (select count(*) from events where status = 'published')::int as events
       from orders`,
    ),
    db.many(
      `select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(o.total_cents), 0)::int8 as cents, count(o.id)::int as orders
         from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
         left join orders o on o.status = 'paid' and date_trunc('day', o.paid_at) = d
        group by d order by d`,
    ),
    db.one(
      `select (select count(*) from photographers where status = 'pending')::int as photographers,
              (select count(*) from payouts where status = 'requested')::int as payouts,
              (select coalesce(sum(amount_cents), 0) from payouts where status = 'requested')::int8 as payouts_cents,
              (select count(*) from orders where status = 'pending' and payment_method = 'pix_manual')::int as manual_orders`,
    ),
    db.many(
      `select ph.display_name, ph.slug, coalesce(sum(oi.price_cents), 0)::int8 as gross_cents, count(oi.id)::int as photos
         from photographers ph
         join order_items oi on oi.photographer_id = ph.user_id
         join orders o on o.id = oi.order_id and o.status = 'paid' and o.paid_at >= date_trunc('month', now())
        group by ph.user_id order by gross_cents desc limit 8`,
    ),
  ]);
  res.json({ totals, series, pending, topPhotographers, mercadopago: mpEnabled(), payments: await paymentOptions() });
});

r.get('/photographers', async (_req, res) => {
  const rows = await db.many(
    `select ph.*, u.email, u.phone, u.name as user_name,
            (select count(*) from events e where e.photographer_id = ph.user_id)::int as events,
            (select count(*) from photos p where p.photographer_id = ph.user_id)::int as photos,
            (select coalesce(sum(oi.price_cents), 0) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
              where oi.photographer_id = ph.user_id)::int8 as gross_cents
       from photographers ph join users u on u.id = ph.user_id
      order by (ph.status = 'pending') desc, ph.created_at desc`,
  );
  const withBalance = await Promise.all(rows.map(async (p) => ({ ...p, balance: await photographerBalance(p.user_id) })));
  res.json({ photographers: withBalance });
});

r.put('/photographers/:id', async (req, res) => {
  const { status, commission_pct: pct } = req.body || {};
  if (status && !['pending', 'approved', 'blocked'].includes(status)) fail(400, 'Status inválido.');
  const commission = pct === '' || pct == null ? null : Math.min(100, Math.max(0, Number(pct)));
  await db.query(
    `update photographers set status = coalesce($2, status), commission_pct = $3 where user_id = $1`,
    [Number(req.params.id), status || null, commission],
  );
  if (status === 'blocked') {
    await db.query(`update events set status = 'hidden' where photographer_id = $1 and status = 'published'`, [Number(req.params.id)]);
    invalidateFaces();
  }
  res.json({ ok: true });
});

r.get('/categories', async (_req, res) => {
  res.json({ categories: await db.many('select c.*, (select count(*) from events e where e.category_id = c.id)::int as events from categories c order by sort, name') });
});

r.post('/categories', async (req, res) => {
  const name = cleanText(req.body?.name, 60);
  if (!name) fail(400, 'Informe o nome da categoria.');
  const row = await db.one(
    `insert into categories (slug, name, sort) values ($1, $2, coalesce($3, (select coalesce(max(sort), 0) + 1 from categories)))
     on conflict (slug) do update set name = excluded.name returning *`,
    [slugify(name), name, Number(req.body?.sort) || null],
  );
  res.json({ category: row });
});

r.put('/categories/:id', async (req, res) => {
  await db.query('update categories set name = coalesce($2, name), sort = coalesce($3, sort) where id = $1', [
    Number(req.params.id), cleanText(req.body?.name, 60), req.body?.sort != null ? Number(req.body.sort) : null,
  ]);
  res.json({ ok: true });
});

r.delete('/categories/:id', async (req, res) => {
  await db.query('delete from categories where id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

r.get('/events', async (_req, res) => {
  const rows = await db.many(
    `select ${EVENT_CARD}, e.views,
            (select count(*) from faces f where f.event_id = e.id)::int as face_count,
            (select coalesce(sum(oi.price_cents), 0) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
              where oi.event_id = e.id)::int8 as gross_cents
       ${EVENT_JOINS} order by e.event_date desc, e.id desc limit 500`,
  );
  res.json({ events: rows.map(eventCard) });
});

r.put('/events/:id/status', async (req, res) => {
  const status = req.body?.status;
  if (!['draft', 'published', 'hidden'].includes(status)) fail(400, 'Status inválido.');
  await db.query(`update events set status = $2, published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end where id = $1`, [Number(req.params.id), status]);
  invalidateFaces();
  res.json({ ok: true });
});

// Exclusao definitiva (para eventos de teste): evento, fotos, arquivos e os pedidos que so tinham fotos dele.
r.post('/events/:id/purge', async (req, res) => {
  const ev = await db.one('select id, title, photographer_id, drive_source_id from events where id = $1', [Number(req.params.id)]);
  if (!ev) fail(404, 'Evento não encontrado.');
  if (String(req.body?.confirm || '').trim() !== ev.title.trim()) fail(400, 'Digite o nome exato do evento para confirmar.');
  const photos = await db.many('select id, original_path, key from photos where event_id = $1', [ev.id]);
  const removed = await db.tx(async (t) => {
    const orderIds = (await t.query('select distinct order_id from order_items where event_id = $1', [ev.id])).rows.map((x) => x.order_id);
    await t.query('delete from order_items where event_id = $1', [ev.id]);
    const del = await t.query(
      'delete from orders o where o.id = any($1::int[]) and not exists (select 1 from order_items oi where oi.order_id = o.id) returning o.id',
      [orderIds],
    );
    // Fotos vindas do Drive ficam como recusadas: a proxima sincronizacao nao as traz de volta
    // ("Revisar de novo" na tela do Google Drive desfaz).
    const sourceId = ev.drive_source_id || (await t.query(
      `select id from drive_sources where kind = 'year' and photographer_id = $1 order by id limit 1`, [ev.photographer_id])).rows[0]?.id;
    if (sourceId) {
      await t.query(
        `insert into drive_skips (drive_file_id, source_id, name, reason)
         select drive_file_id, $2, original_name, 'excluída pelo administrador' from photos where event_id = $1 and drive_file_id is not null
         on conflict (drive_file_id) do nothing`,
        [ev.id, sourceId],
      );
    }
    await t.query('delete from drive_sources where event_id = $1', [ev.id]);
    await t.query('delete from events where id = $1', [ev.id]);
    return del.rows.length;
  });
  for (const p of photos) await removePhotoFiles(ev.id, p.id, p.original_path, p.key);
  invalidateFaces();
  res.json({ ok: true, photos: photos.length, orders: removed });
});

r.get('/orders', async (req, res) => {
  const status = ['pending', 'paid', 'cancelled', 'refunded'].includes(req.query.status) ? req.query.status : null;
  const q = cleanText(req.query.q, 80);
  const rows = await db.many(
    `select o.id, o.code, o.status, o.total_cents, o.discount_cents, o.payment_method, o.created_at, o.paid_at, o.coupon_code,
            o.payment_provider, o.ip_receipt_url, o.installments,
            u.name as buyer, u.email, u.phone, count(oi.id)::int as items
       from orders o join users u on u.id = o.user_id left join order_items oi on oi.order_id = o.id
      where ($1::text is null or o.status = $1) and ($2::text is null or o.code ilike '%' || $2 || '%' or u.email ilike '%' || $2 || '%' or u.name ilike '%' || $2 || '%')
      group by o.id, u.id order by o.created_at desc limit 300`,
    [status, q],
  );
  res.json({ orders: rows });
});

// Pix manual (sem Mercado Pago): o admin confere o extrato e libera o pedido.
r.post('/orders/:id/mark-paid', async (req, res) => {
  const o = await markOrderPaid(Number(req.params.id), null);
  if (!o) fail(409, 'Pedido não está pendente.');
  res.json({ ok: true });
});

r.post('/orders/:id/cancel', async (req, res) => {
  const refund = !!req.body?.refund;
  await db.query(
    `update orders set status = $2 where id = $1 and status = $3`,
    [Number(req.params.id), refund ? 'refunded' : 'cancelled', refund ? 'paid' : 'pending'],
  );
  res.json({ ok: true });
});

r.get('/payouts', async (_req, res) => {
  const rows = await db.many(
    `select py.*, ph.display_name, ph.pix_key_type, u.email from payouts py
       join photographers ph on ph.user_id = py.photographer_id join users u on u.id = py.photographer_id
      order by (py.status = 'requested') desc, py.requested_at desc limit 300`,
  );
  res.json({ payouts: rows });
});

r.post('/payouts/:id/:action', async (req, res) => {
  const action = req.params.action;
  if (!['pay', 'reject'].includes(action)) fail(404, 'Ação inválida.');
  await db.query(
    `update payouts set status = $2, paid_at = case when $2 = 'paid' then now() end, note = $3 where id = $1 and status = 'requested'`,
    [Number(req.params.id), action === 'pay' ? 'paid' : 'rejected', cleanText(req.body?.note, 300)],
  );
  res.json({ ok: true });
});

r.get('/users', async (req, res) => {
  const q = cleanText(req.query.q, 80);
  const rows = await db.many(
    `select u.id, u.name, u.email, u.phone, u.role, u.created_at,
            (select count(*) from orders o where o.user_id = u.id and o.status = 'paid')::int as orders
       from users u where ($1::text is null or u.email ilike '%' || $1 || '%' or u.name ilike '%' || $1 || '%')
      order by u.created_at desc limit 200`,
    [q],
  );
  res.json({ users: rows });
});

// Sem e-mail transacional ainda: o admin gera uma senha provisoria e manda pelo WhatsApp.
r.post('/users/:id/reset-password', async (req, res) => {
  const temp = crypto.randomBytes(6).toString('base64url');
  await db.query('update users set password_hash = $2 where id = $1', [Number(req.params.id), await hashPassword(temp)]);
  res.json({ password: temp });
});

r.get('/settings', async (_req, res) => {
  const rows = await db.many('select key, value from settings');
  res.json({ settings: Object.fromEntries(rows.map((x) => [x.key, x.value])), mercadopago: mpEnabled(), payments: await paymentOptions() });
});

r.put('/settings', async (req, res) => {
  const b = req.body || {};
  if (b.commission_pct != null) await setSetting('commission_pct', Math.min(100, Math.max(0, Number(b.commission_pct))));
  if (b.release_days != null) await setSetting('release_days', Math.min(60, Math.max(0, Math.round(Number(b.release_days)))));
  if (b.min_payout_cents != null) await setSetting('min_payout_cents', Math.max(0, Math.round(Number(b.min_payout_cents))));
  if (b.payments) {
    const ok = (v) => (['mercadopago', 'infinitepay'].includes(v) ? v : null);
    await setSetting('payments', { pix: ok(b.payments.pix), card: ok(b.payments.card) });
  }
  if (b.site) {
    const cur = await getSetting('site', {});
    const s = b.site;
    await setSetting('site', {
      ...cur,
      whatsapp: cleanText(String(s.whatsapp ?? cur.whatsapp ?? '').replace(/\D/g, ''), 20),
      instagram: cleanText(String(s.instagram ?? cur.instagram ?? '').replace(/^@/, ''), 60),
      tagline: cleanText(s.tagline ?? cur.tagline, 120),
      about: cleanText(s.about ?? cur.about, 1500),
      pix_key: cleanText(s.pix_key ?? cur.pix_key, 140),
      pix_name: cleanText(s.pix_name ?? cur.pix_name, 120),
      since: Number(s.since ?? cur.since) || 2003,
    });
  }
  res.json({ ok: true });
});

r.post('/settings/:asset', upload.single('file'), async (req, res) => {
  const kind = req.params.asset;
  if (!['logo', 'hero'].includes(kind)) fail(404, 'Imagem inválida.');
  if (!req.file) fail(400, 'Envie uma imagem.');
  const url = await storeAsset(req.file.path, 'site', { maxSide: kind === 'logo' ? 600 : 2000 });
  const cur = await getSetting('site', {});
  await setSetting('site', { ...cur, [kind]: url });
  res.json({ url });
});

// ---------- Marca d'agua padrao do site ----------

r.get('/watermark', async (_req, res) => {
  res.json({ watermark: normalizeWatermark(await getSetting('watermark', null)), queue: await queueStatus() });
});

r.put('/watermark', async (req, res) => {
  const wm = normalizeWatermark(req.body?.watermark);
  await setSetting('watermark', wm);
  clearWatermarkCache();
  // Refaz as vitrines de quem usa a marca do site (inclusive fotografos que escolheram a propria mas nao cadastraram).
  const r2 = await db.query(
    `update photos set needs_render = true where event_id in (
       select e.id from events e left join photographers ph on ph.user_id = e.photographer_id
        where e.watermark_mode = 'site' or (e.watermark_mode = 'photographer' and ph.watermark is null))`,
  );
  res.json({ ok: true, rerender: r2.rowCount ?? r2.affectedRows ?? 0 });
});

r.post('/watermark/image', upload.single('file'), async (req, res) => {
  if (!req.file) fail(400, 'Envie o logo em PNG (de preferência com fundo transparente).');
  res.json({ url: await storeAsset(req.file.path, 'marcas', { maxSide: 1200, png: true }) });
});

r.post('/watermark/preview', async (req, res) => {
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'no-store');
  res.end(await watermarkPreview(normalizeWatermark(req.body?.watermark)));
});

r.get('/system', async (_req, res) => {
  res.json({ drive: driveInfo(), queue: await queueStatus() });
});

export default r;
