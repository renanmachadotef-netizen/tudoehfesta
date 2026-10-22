import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { activity, recentActivity, progress, rate, startedAt } from '../activity.js';
import { requireAdmin, hashPassword } from '../auth.js';
import { getSetting, setSetting, normalizeArchive, refreshArchivePricing, archivePricing, priceCart } from '../pricing.js';
import { markOrderPaid, mpEnabled, paymentOptions } from '../payments.js';
import { dirs, storeAsset, removePhotoFiles, thumbUrl } from '../storage.js';
import { invalidateFaces } from '../faces.js';
import { normalizeWatermark, watermarkPreview, clearWatermarkCache } from '../watermark.js';
import { queueStatus } from '../jobs.js';
import { driveInfo, SYNC_MINUTES } from '../drive.js';
import { EVENT_CARD, EVENT_JOINS, eventCard } from './public.js';
import { fail, cleanText, slugify, photographerBalance, isEmail } from '../util.js';

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
       ${EVENT_JOINS} order by e.event_date desc, e.id desc limit 3000`,
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
  activity('exclusao', `Excluído do site: ${ev.title} (${photos.length} fotos)`);
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
// Corrigir nome, e-mail ou WhatsApp de um usuario (cadastro mal preenchido).
r.put('/users/:id', async (req, res) => {
  const u = await db.one('select id, email from users where id = $1', [Number(req.params.id)]);
  if (!u) fail(404, 'Usuário não encontrado.');
  const name = cleanText(req.body?.name, 120);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const phone = cleanText(req.body?.phone, 30) || null;
  if (!name) fail(400, 'Informe o nome.');
  if (!isEmail(email)) fail(400, 'E-mail inválido.');
  if (email !== u.email && (await db.one('select id from users where email = $1 and id <> $2', [email, u.id]))) {
    fail(409, 'Já existe outra conta com este e-mail.');
  }
  await db.query('update users set name = $2, email = $3, phone = $4 where id = $1', [u.id, name, email, phone]);
  activity('cliente', `Admin corrigiu o cadastro do usuário #${u.id}`);
  res.json({ ok: true });
});

// Excluir usuario: so quem nao tem compras pagas nem eventos/fotos (o historico financeiro fica intacto).
// Leva junto rosto cadastrado, sugestoes, pedidos nao pagos e o borrao que ele tinha pedido.
r.delete('/users/:id', async (req, res) => {
  const u = await db.one('select id, role, email from users where id = $1', [Number(req.params.id)]);
  if (!u) fail(404, 'Usuário não encontrado.');
  if (u.id === req.user.id) fail(400, 'Você não pode excluir a própria conta.');
  if (u.role === 'admin') fail(400, 'Contas de administrador não podem ser excluídas por aqui.');
  const block = await db.one(
    `select (select count(*) from orders where user_id = $1 and status in ('paid', 'refunded'))::int as paid,
            (select count(*) from events where photographer_id = $1)::int as events,
            (select count(*) from photos where photographer_id = $1)::int as photos,
            (select count(*) from payouts where photographer_id = $1)::int as payouts`,
    [u.id],
  );
  if (block.paid) fail(409, `Este usuário tem ${block.paid} compra(s) paga(s): o histórico precisa ficar. Corrija o cadastro em vez de excluir.`);
  if (block.events || block.photos || block.payouts) fail(409, 'Este fotógrafo tem eventos ou saques registrados. Desative-o em vez de excluir.');
  const blurred = await db.many('select distinct photo_id from faces where blurred_user_id = $1', [u.id]);
  await db.tx(async (t) => {
    await t.query(`delete from orders where user_id = $1 and status not in ('paid', 'refunded')`, [u.id]);
    await t.query('delete from users where id = $1', [u.id]);
  });
  // O borrao que ele pediu deixa de existir: as previas dessas fotos sao refeitas sem ele.
  if (blurred.length) await db.query('update photos set needs_render = true where id = any($1::int[])', [blurred.map((r) => r.photo_id)]);
  invalidateFaces();
  activity('exclusao', `Usuário #${u.id} excluído pelo admin`);
  res.json({ ok: true });
});

// ----- Carrinhos abandonados e pedidos nao pagos -----
// Itens de recuperacao: pedidos pendentes/cancelados (Pix gerado e nao pago) e carrinhos salvos parados ha mais de
// 30 min. Um pedido conta como recuperado quando a mesma pessoa pagou depois um pedido com alguma das fotos.
const ABANDON_MINUTES = Math.max(0, Number(process.env.CART_ABANDON_MINUTES ?? 30));
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const waPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return null;
  return d.length <= 11 ? `55${d}` : d;
};
r.get('/abandoned', async (req, res) => {
  const base = config.publicUrl;
  const orders = await db.many(
    `select o.id, o.code, o.status, o.total_cents, o.created_at, o.recovery_status, o.contacted_at, o.payment_provider,
            (o.pix_qr is not null) as pix_generated, u.id as user_id, u.name, u.email, u.phone,
            (select count(*) from order_items oi where oi.order_id = o.id)::int as items,
            (select string_agg(distinct e.title, ', ') from order_items oi join events e on e.id = oi.event_id where oi.order_id = o.id) as events,
            exists (select 1 from orders o2 join order_items i2 on i2.order_id = o2.id
                     where o2.user_id = o.user_id and o2.status = 'paid' and o2.created_at >= o.created_at
                       and i2.photo_id in (select photo_id from order_items where order_id = o.id)) as recovered
       from orders o join users u on u.id = o.user_id
      where o.status in ('pending', 'cancelled')
      order by o.created_at desc limit 500`,
  );
  const carts = await db.many(
    `select c.user_id, c.photo_ids, c.token, c.updated_at, c.recovery_status, c.contacted_at, u.name, u.email, u.phone
       from carts c join users u on u.id = c.user_id
      where cardinality(c.photo_ids) > 0 and c.updated_at < now() - make_interval(mins => $1)
        and not exists (select 1 from orders o where o.user_id = c.user_id and o.created_at >= c.updated_at)
      order by c.updated_at desc limit 300`,
    [ABANDON_MINUTES],
  );
  const list = [];
  for (const o of orders) {
    const status = o.recovered ? 'recovered' : o.recovery_status;
    const link = o.status === 'pending' ? `${base}/pedido/${o.code}` : `${base}/carrinho?r=${o.code}`;
    list.push({
      kind: 'order', id: o.id, ref: o.code, name: o.name, email: o.email, phone: o.phone, wa: waPhone(o.phone),
      total_cents: o.total_cents, items: o.items, events: o.events, created_at: o.created_at, updated_at: o.created_at,
      stage: o.status === 'pending' ? (o.pix_generated ? 'Pix gerado' : 'Aguardando pagamento') : 'Pedido expirado',
      status, contacted_at: o.contacted_at, link,
      message: `Oi ${firstName(o.name)}! Aqui é da Tudo Eh Festa. Vi que você separou ${o.items} foto(s)${o.events ? ` de ${o.events}` : ''} e o pagamento não foi concluído. Suas fotos continuam guardadas, é só finalizar por aqui: ${link}`,
    });
  }
  for (const c of carts) {
    // Fotos do carrinho que a pessoa ainda nao comprou
    const paid = new Set((await db.many(
      `select oi.photo_id from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where o.user_id = $1`, [c.user_id],
    )).map((x) => x.photo_id));
    const ids = c.photo_ids.filter((id) => !paid.has(id));
    if (!ids.length) continue;
    const priced = await priceCart(ids, null);
    if (!priced.items.length) continue;
    const link = `${base}/carrinho?r=${c.token}`;
    const events = priced.groups.map((g) => g.title).join(', ');
    list.push({
      kind: 'cart', id: c.user_id, ref: 'carrinho', name: c.name, email: c.email, phone: c.phone, wa: waPhone(c.phone),
      total_cents: priced.total, items: priced.items.length, events, created_at: c.updated_at, updated_at: c.updated_at,
      stage: 'No carrinho', status: c.recovery_status, contacted_at: c.contacted_at, link,
      message: `Oi ${firstName(c.name)}! Aqui é da Tudo Eh Festa. Suas ${priced.items.length} foto(s)${events ? ` de ${events}` : ''} ainda estão no carrinho esperando você. É só finalizar por aqui: ${link}`,
    });
  }
  list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const sum = (st) => list.filter((x) => x.status === st).reduce((a, x) => ({ n: a.n + 1, cents: a.cents + x.total_cents, items: a.items + x.items }), { n: 0, cents: 0, items: 0 });
  res.json({ list, totals: { open: sum('open'), contacted: sum('contacted'), lost: sum('lost'), recovered: sum('recovered') } });
});

r.put('/abandoned/:kind/:id', async (req, res) => {
  const status = req.body?.status;
  if (!['open', 'contacted', 'lost'].includes(status)) fail(400, 'Status inválido.');
  const table = req.params.kind === 'cart' ? 'carts' : req.params.kind === 'order' ? 'orders' : null;
  if (!table) fail(400, 'Tipo inválido.');
  const key = table === 'carts' ? 'user_id' : 'id';
  await db.query(
    `update ${table} set recovery_status = $2, contacted_at = case when $2 = 'contacted' then now() else contacted_at end where ${key} = $1`,
    [Number(req.params.id), status],
  );
  res.json({ ok: true });
});

// ----- Visitas e conversao -----
// Horario de Brasilia (UTC-3) para dia, dia da semana e hora.
const BR = (col) => `(${col} at time zone 'UTC' - interval '3 hours')`;
r.get('/visits', async (req, res) => {
  const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const since = `now() - make_interval(days => ${days})`;
  const [totals, byDay, byWeekday, byHour, byDevice, byPage, topEvents] = await Promise.all([
    db.one(
      `select (select count(*) from visits where at >= ${since})::int as visits,
              (select count(distinct visitor) from visits where at >= ${since})::int as visitors,
              (select count(*) from orders where status = 'paid' and paid_at >= ${since})::int as orders,
              (select coalesce(sum(total_cents), 0) from orders where status = 'paid' and paid_at >= ${since})::int as cents,
              (select count(*) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where o.paid_at >= ${since})::int as photos`,
    ),
    db.many(
      `select d::date::text as day,
              (select count(*) from visits v where ${BR('v.at')}::date = d::date)::int as visits,
              (select count(distinct visitor) from visits v where ${BR('v.at')}::date = d::date)::int as visitors,
              (select count(*) from orders o where o.status = 'paid' and ${BR('o.paid_at')}::date = d::date)::int as orders,
              (select coalesce(sum(total_cents), 0) from orders o where o.status = 'paid' and ${BR('o.paid_at')}::date = d::date)::int as cents
         from generate_series((${BR('now()')})::date - ${days - 1}, (${BR('now()')})::date, interval '1 day') d order by d`,
    ),
    db.many(`select extract(dow from ${BR('at')})::int as k, count(*)::int as visits from visits where at >= ${since} group by 1`),
    db.many(`select extract(hour from ${BR('at')})::int as k, count(*)::int as visits from visits where at >= ${since} group by 1`),
    db.many(`select device as k, count(*)::int as visits, count(distinct visitor)::int as visitors from visits where at >= ${since} group by 1 order by 2 desc`),
    db.many(`select page as k, count(*)::int as visits from visits where at >= ${since} group by 1 order by 2 desc`),
    db.many(
      `select e.id, e.title, e.slug, e.kind, count(v.id)::int as visits, count(distinct v.visitor)::int as visitors,
              (select count(distinct o.id) from orders o join order_items oi on oi.order_id = o.id
                where o.status = 'paid' and o.paid_at >= ${since} and oi.event_id = e.id)::int as orders,
              (select count(*) from orders o join order_items oi on oi.order_id = o.id
                where o.status = 'paid' and o.paid_at >= ${since} and oi.event_id = e.id)::int as photos,
              (select coalesce(sum(oi.price_cents), 0) from orders o join order_items oi on oi.order_id = o.id
                where o.status = 'paid' and o.paid_at >= ${since} and oi.event_id = e.id)::int as cents
         from visits v join events e on e.id = v.event_id
        where v.at >= ${since} group by e.id order by visits desc limit 20`,
    ),
  ]);
  const fill = (rows, n) => Array.from({ length: n }, (_, k) => rows.find((r) => r.k === k)?.visits || 0);
  res.json({
    days, totals, byDay, byWeekday: fill(byWeekday, 7), byHour: fill(byHour, 24), byDevice, byPage,
    topEvents: topEvents.map((e) => ({ ...e, conversion: e.visitors ? e.orders / e.visitors : 0 })),
  });
});

// ----- Clientes: quem comprou, quanto e quando -----
const CLIENTS_SQL = `
  select u.id, u.name, u.email, u.phone, u.created_at,
         count(distinct o.id) filter (where o.status = 'paid')::int as orders,
         count(oi.id) filter (where o.status = 'paid')::int as photos,
         coalesce(sum(oi.price_cents) filter (where o.status = 'paid'), 0)::int as total_cents,
         min(o.paid_at) as first_purchase, max(o.paid_at) as last_purchase,
         (select string_agg(t.title, ', ') from (select distinct e.title from order_items i2 join orders o2 on o2.id = i2.order_id and o2.status = 'paid'
            join events e on e.id = i2.event_id where o2.user_id = u.id limit 4) t) as events,
         exists (select 1 from user_faces f where f.user_id = u.id) as has_face
    from users u
    left join orders o on o.user_id = u.id
    left join order_items oi on oi.order_id = o.id
   where u.role = 'customer' and ($1::text is null or u.name ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%' or u.phone ilike '%' || $1 || '%')
   group by u.id`;
const CLIENT_ORDER = { total: 'total_cents desc', orders: 'orders desc', recent: 'last_purchase desc nulls last', name: 'u.name asc' };
r.get('/clients', async (req, res) => {
  const q = cleanText(req.query.q, 80);
  const order = CLIENT_ORDER[req.query.sort] || CLIENT_ORDER.total;
  const buyers = req.query.all === '1' ? '' : 'having count(distinct o.id) filter (where o.status = \'paid\') > 0';
  const rows = await db.many(`${CLIENTS_SQL} ${buyers} order by ${order}, u.id desc limit 1000`, [q]);
  res.json({ clients: rows.map((c) => ({ ...c, wa: waPhone(c.phone) })) });
});
r.get('/clients.csv', async (req, res) => {
  const rows = await db.many(`${CLIENTS_SQL} order by total_cents desc, u.id desc`, [null]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const lines = [['nome', 'email', 'whatsapp', 'pedidos', 'fotos', 'total_reais', 'primeira_compra', 'ultima_compra', 'eventos', 'cadastro'].join(';')];
  for (const c of rows) {
    lines.push([c.name, c.email, c.phone, c.orders, c.photos, (c.total_cents / 100).toFixed(2).replace('.', ','), day(c.first_purchase), day(c.last_purchase), c.events, day(c.created_at)].map(esc).join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="clientes-tudoehfesta.csv"');
  res.send('\ufeff' + lines.join('\n'));
});

r.post('/users/:id/reset-password', async (req, res) => {
  const temp = crypto.randomBytes(6).toString('base64url');
  await db.query('update users set password_hash = $2 where id = $1', [Number(req.params.id), await hashPassword(temp)]);
  res.json({ password: temp });
});

r.get('/settings', async (_req, res) => {
  const rows = await db.many('select key, value from settings');
  res.json({ settings: Object.fromEntries(rows.map((x) => [x.key, x.value])), mercadopago: mpEnabled(), payments: await paymentOptions(), archive: archivePricing() });
});

r.put('/settings', async (req, res) => {
  const b = req.body || {};
  if (b.commission_pct != null) await setSetting('commission_pct', Math.min(100, Math.max(0, Number(b.commission_pct))));
  if (b.release_days != null) await setSetting('release_days', Math.min(60, Math.max(0, Math.round(Number(b.release_days)))));
  if (b.min_payout_cents != null) await setSetting('min_payout_cents', Math.max(0, Math.round(Number(b.min_payout_cents))));
  if (b.archive_pricing) {
    await setSetting('archive_pricing', normalizeArchive(b.archive_pricing));
    await refreshArchivePricing();
  }
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

// Painel "Ao vivo": o que o servidor esta fazendo agora (atualizado a cada poucos segundos pela tela).
r.get('/live', async (_req, res) => {
  const cursor = Number(await getSetting('match_cursor', 0)) || 0;
  const [queue, extra, totals, sources, recentPhotos, orders, lastOrders, disk] = await Promise.all([
    queueStatus(),
    db.one(
      `select (select count(*) from photos where needs_copy)::int as copy,
              (select count(*) from users where needs_face_scan)::int as face_scans,
              (select count(*) from faces where id > $1)::int as match_backlog`,
      [cursor],
    ),
    db.one(
      `select (select count(*) from photos where key is not null)::int as photos,
              (select count(*) from faces)::int as faces,
              (select count(*) from events where kind = 'pool')::int as pool_groups,
              (select count(*) from events where kind = 'event')::int as events,
              (select count(*) from users where role = 'customer')::int as customers,
              (select count(distinct user_id) from user_faces)::int as face_users,
              (select count(*) from users where blur_me)::int as blur_users,
              (select count(*) from user_matches where created_at > now() - interval '24 hours')::int as matches_24h,
              (select count(*) from photos where created_at > now() - interval '24 hours')::int as photos_24h,
              (select coalesce(sum(bytes), 0) from photos where original_path not like 'drive:%')::bigint as server_originals_bytes`,
    ),
    db.many(
      `select s.id, s.name, s.kind, s.active, s.last_status, s.last_error, s.last_sync_at, s.scan, e.title as event_title,
              (select count(*) from photos p join events ev on ev.id = p.event_id where ev.drive_source_id = s.id or ev.id = s.event_id)::int as photos,
              (select count(*) from drive_skips k where k.source_id = s.id)::int as skipped
         from drive_sources s left join events e on e.id = s.event_id order by s.kind desc, s.id`,
    ),
    db.many(
      `select p.id, p.event_id, p.key, p.created_at, p.faces_count, e.title as event_title, e.kind
         from photos p join events e on e.id = p.event_id where p.key is not null order by p.id desc limit 24`,
    ),
    db.one(
      `select count(*) filter (where created_at::date = current_date)::int as today,
              count(*) filter (where status = 'paid' and paid_at::date = current_date)::int as paid_today,
              coalesce(sum(total_cents) filter (where status = 'paid' and paid_at::date = current_date), 0)::int as paid_today_cents,
              count(*) filter (where status = 'pending')::int as pending
         from orders`,
    ),
    db.many(
      `select o.code, o.status, o.total_cents, o.payment_method, o.payment_provider, o.created_at, o.paid_at, split_part(u.name, ' ', 1) as buyer,
              (select count(*) from order_items oi where oi.order_id = o.id)::int as items
         from orders o join users u on u.id = o.user_id order by o.created_at desc limit 6`,
    ),
    fsp.statfs(config.dataDir).then((s) => ({ total: s.blocks * s.bsize, free: s.bavail * s.bsize })).catch(() => null),
  ]);
  const mem = process.memoryUsage();
  res.json({
    now: new Date().toISOString(),
    server: { uptime_s: Math.round((Date.now() - startedAt) / 1000), rss: mem.rss, load: os.loadavg(), cpus: os.cpus().length, disk, sweep: progress.sweep || null },
    drive: { ...driveInfo(), sync_minutes: SYNC_MINUTES, running: progress.sync, sources },
    queue: { ...queue, ...extra },
    rates: Object.fromEntries(['import', 'skip', 'render', 'scan', 'faces', 'match'].map((k) => [k, { m10: rate(k, 10), m60: rate(k, 60) }])),
    totals: { ...totals, server_originals_bytes: Number(totals.server_originals_bytes) },
    orders: { ...orders, last: lastOrders },
    recentPhotos: recentPhotos.map((p) => ({ id: p.id, thumb: thumbUrl(p.event_id, p.id, p.key), event_title: p.event_title, kind: p.kind, faces: p.faces_count, created_at: p.created_at })),
    activity: recentActivity(150),
  });
});

export default r;
