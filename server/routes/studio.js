import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { requirePhotographer, requireUser, hashPassword } from '../auth.js';
import { dirs, saveOriginal, renderPhoto, photoSha, removePhotoFiles, storeAsset, movePhotoFiles, PROTECT_MODES } from '../storage.js';
import { normalizeWatermark, watermarkPreview, clearWatermarkCache } from '../watermark.js';
import { driveInfo, parseFolderId, folderName, previewSource, ignoreWords } from '../drive.js';
import { queueStatus } from '../jobs.js';
import { encodeDescriptor, invalidateFaces } from '../faces.js';
import { getSetting, setSetting, effectivePrice } from '../pricing.js';
import { EVENT_CARD, EVENT_JOINS, eventCard, photoOut } from './public.js';
import { fail, cleanText, toCents, uniqueSlug, photographerBalance, myCents, isMine } from '../util.js';

const r = Router();
const upload = multer({
  dest: dirs.tmp,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});
const wmUpload = multer({ dest: dirs.tmp, limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

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

// Dono do evento, admin ou fotografo convidado (equipe). role: 'owner' | 'team'.
async function teamEvent(req, id) {
  const ev = await db.one('select * from events where id = $1', [Number(id)]);
  if (!ev) fail(404, 'Evento não encontrado.');
  if (ev.photographer_id === req.user.id || req.user.role === 'admin') return { ev, role: 'owner', member: null };
  const member = await db.one('select * from event_team where event_id = $1 and user_id = $2', [ev.id, req.user.id]);
  if (!member) fail(404, 'Evento não encontrado.');
  return { ev, role: 'team', member };
}

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
         coalesce(sum(${myCents()}) filter (where o.paid_at >= date_trunc('day', now())), 0)::int8 as today,
         coalesce(sum(${myCents()}) filter (where o.paid_at >= now() - interval '7 days'), 0)::int8 as week,
         coalesce(sum(${myCents()}) filter (where o.paid_at >= date_trunc('month', now())), 0)::int8 as month,
         count(oi.id) filter (where o.paid_at >= date_trunc('month', now()))::int as photos_month,
         count(distinct o.user_id) filter (where o.paid_at >= date_trunc('month', now()))::int as buyers_month
       from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where ${isMine()}`,
      [uid],
    ),
    db.many(
      `select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(${myCents()}), 0)::int8 as cents, count(oi.id)::int as photos
         from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
         left join orders o on o.status = 'paid' and date_trunc('day', o.paid_at) = d
         left join order_items oi on oi.order_id = o.id and ${isMine()}
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
      `select o.code, o.paid_at, u.name as buyer, count(oi.id)::int as photos, sum(${myCents()})::int8 as cents, min(e.title) as event_title
         from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
         join users u on u.id = o.user_id join events e on e.id = oi.event_id
        where ${isMine()} group by o.id, u.name order by o.paid_at desc limit 10`,
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
  const mine = req.user.role === 'admin' && req.query.all ? '' : 'where e.photographer_id = $1 or e.id in (select event_id from event_team where user_id = $1)';
  const rows = await db.many(
    `select ${EVENT_CARD}, e.views, ${mine ? '(e.photographer_id <> $1)' : 'false'} as is_team,
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
    hide_gallery: !!b.hide_gallery,
    watermark_mode: WM_MODES.includes(b.watermark_mode) ? b.watermark_mode : 'site',
    visibility: ['public', 'unlisted', 'password'].includes(b.visibility) ? b.visibility : 'public',
    protect_mode: PROTECT_MODES.includes(b.protect_mode) ? b.protect_mode : 'none',
    bib_search: !!b.bib_search,
    accepts_partners: !!b.accepts_partners,
    password: cleanText(b.password, 60) || null,
    // "Publicar automaticamente em" chega como data e hora de Brasilia (sem fuso).
    publish_at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(b.publish_at || '')) ? `${b.publish_at}:00-03:00` : null,
  };
}

const WM_MODES = ['site', 'photographer', 'none'];

r.post('/events', async (req, res) => {
  const f = eventFields(req.body || {});
  const slug = await uniqueSlug('events', `${f.title} ${f.event_date.slice(0, 4)}`);
  const ev = await db.one(
    `insert into events (slug, title, description, category_id, photographer_id, event_date, city, venue, price_cents,
       pack_price_cents, discount_tiers, status, published_at, hide_gallery, watermark_mode)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, case when $12 = 'published' then now() end, $13, $14)
     returning id, slug`,
    [slug, f.title, f.description, f.category_id, req.user.id, f.event_date, f.city, f.venue, f.price_cents,
      f.pack_price_cents, f.discount_tiers, f.status, f.hide_gallery, f.watermark_mode],
  );
  if (f.visibility === 'password' && !f.password) fail(400, 'Defina a senha do evento.');
  await db.query('update events set visibility = $2, password_hash = $3, publish_at = $4, protect_mode = $5, bib_search = $6, accepts_partners = $7 where id = $1',
    [ev.id, f.visibility, f.password ? await hashPassword(f.password) : null, f.publish_at, f.protect_mode, f.bib_search, f.accepts_partners]);
  res.json({ event: ev });
});

r.get('/events/:id', async (req, res) => {
  const { ev, role, member } = await teamEvent(req, req.params.id);
  const row = await db.one(
    `select ${EVENT_CARD}, e.description, e.views, e.cover_photo_id, e.drive_folder_id, e.auto_publish,
            (select count(*) from faces f where f.event_id = e.id)::int as face_count ${EVENT_JOINS} where e.id = $1`,
    [ev.id],
  );
  let team = null;
  if (role === 'team') {
    const mine = await db.one(
      `select (select count(*) from photos where event_id = $1 and photographer_id = $2)::int as photos,
              (select coalesce(sum(oi.photographer_cents), 0) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
                where oi.event_id = $1 and oi.photographer_id = $2)::int as cents`,
      [ev.id, req.user.id],
    );
    team = { max_photos: member.max_photos, upload_until: member.upload_until, organizer_pct: ev.organizer_pct, ...mine };
  }
  const bib = ev.bib_search ? await db.one(
    `select count(*) filter (where bib_done)::int as done, count(*)::int as total,
            (select count(distinct photo_id) from photo_bibs where event_id = $1)::int as with_number
       from photos where event_id = $1 and key is not null`,
    [ev.id],
  ) : null;
  res.json({ event: { ...eventCard(row), pricing: effectivePrice(row), role, team, organizer_pct: ev.organizer_pct, bib }, queue: await queueStatus('p.event_id = $1', [ev.id]) });
});

r.put('/events/:id', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const f = eventFields(req.body || {});
  const slug = f.title !== ev.title ? await uniqueSlug('events', `${f.title} ${f.event_date.slice(0, 4)}`, ev.id) : ev.slug;
  await db.query(
    `update events set slug = $2, title = $3, description = $4, category_id = $5, event_date = $6, city = $7, venue = $8,
       price_cents = $9, pack_price_cents = $10, discount_tiers = $11::jsonb,
       auto_publish = case when $12 <> status then false else auto_publish end,
       status = $12,
       published_at = case when $12 = 'published' then coalesce(published_at, now()) else published_at end,
       hide_gallery = $13, watermark_mode = $14
     where id = $1`,
    [ev.id, slug, f.title, f.description, f.category_id, f.event_date, f.city, f.venue, f.price_cents, f.pack_price_cents,
      f.discount_tiers, f.status, f.hide_gallery, f.watermark_mode],
  );
  if (f.visibility === 'password' && !f.password && !ev.password_hash) fail(400, 'Defina a senha do evento.');
  await db.query('update events set visibility = $2, password_hash = coalesce($3, password_hash), publish_at = $4, protect_mode = $5, bib_search = $6, accepts_partners = $7 where id = $1',
    [ev.id, f.visibility, f.password ? await hashPassword(f.password) : null, f.status === 'draft' ? f.publish_at : null, f.protect_mode, f.bib_search, f.accepts_partners]);
  // Protecao da previa mudou: refaz as previas. (Busca por numero ligada: a fila le as fotos com bib_done = false.)
  if ((ev.protect_mode || 'none') !== f.protect_mode) await db.query('update photos set needs_render = true where event_id = $1', [ev.id]);

  if (String(ev.event_date) !== f.event_date) {
    await db.query('update faces set year = $2 where event_id = $1', [ev.id, Number(f.event_date.slice(0, 4))]);
  }
  // Marca d'agua trocada: refaz vitrines em segundo plano (os originais nao mudam).
  if (ev.watermark_mode !== f.watermark_mode) {
    clearWatermarkCache();
    await db.query('update photos set needs_render = true where event_id = $1', [ev.id]);
  }
  invalidateFaces();
  res.json({ ok: true, slug });
});

r.delete('/events/:id', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const sold = await db.one('select count(*)::int as n from order_items where event_id = $1', [ev.id]);
  if (sold.n) fail(409, 'Este evento já tem vendas: oculte-o em vez de excluir.');
  const photos = await db.many('select id, original_path, key from photos where event_id = $1', [ev.id]);
  await db.query('delete from events where id = $1', [ev.id]);
  for (const p of photos) await removePhotoFiles(ev.id, p.id, p.original_path, p.key);
  invalidateFaces();
  res.json({ ok: true });
});

r.put('/events/:id/cover', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const p = await db.one('select id from photos where id = $1 and event_id = $2 and not hidden', [Number(req.body?.photoId), ev.id]);
  if (!p) fail(404, 'Foto não encontrada (ou está oculta).');
  await db.query('update events set cover_photo_id = $2 where id = $1', [ev.id, p.id]);
  res.json({ ok: true });
});

r.get('/events/:id/photos', async (req, res) => {
  const { ev, role } = await teamEvent(req, req.params.id);
  const rows = await db.many(
    `select p.id, p.event_id, p.width, p.height, p.key, p.faces_count, p.original_name, p.needs_faces, p.needs_render, p.hidden,
            p.photographer_id, coalesce(ph.display_name, u.name) as photographer_name,
            (select count(*) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where oi.photo_id = p.id)::int as sold
       from photos p left join photographers ph on ph.user_id = p.photographer_id left join users u on u.id = p.photographer_id
      where p.event_id = $1 and p.key is not null and ($2::int is null or p.photographer_id = $2)
      order by p.sort_key nulls last, p.id`,
    [ev.id, role === 'team' ? req.user.id : null],
  );
  res.json({
    photos: rows.map((p) => ({ ...photoOut(p), faces: p.faces_count, name: p.original_name, sold: p.sold, pending: p.needs_faces || p.needs_render, hidden: p.hidden, photographer_id: p.photographer_id, photographer_name: p.photographer_name })),
  });
});

// Upload de uma foto por requisicao (o navegador manda varias em paralelo). Normalmente os rostos chegam
// calculados pelo navegador do fotografo; sem eles (faces_done ausente) o servidor indexa em segundo plano.
r.post('/events/:id/photos', upload.single('file'), async (req, res) => {
  const { ev, role, member } = await teamEvent(req, req.params.id);
  if (!req.file) fail(400, 'Arquivo inválido: envie JPG, PNG ou WEBP.');
  const uploader = role === 'team' ? req.user.id : ev.photographer_id;
  if (role === 'team') {
    const drop = () => fsp.unlink(req.file.path).catch(() => {});
    if (member.upload_until && new Date(member.upload_until) < new Date()) { await drop(); fail(403, 'O prazo de envio de fotos para este evento terminou.'); }
    if (member.max_photos) {
      const n = await db.one('select count(*)::int as n from photos where event_id = $1 and photographer_id = $2', [ev.id, req.user.id]);
      if (n.n >= member.max_photos) { await drop(); fail(403, `Você já enviou o limite de ${member.max_photos} fotos para este evento.`); }
    }
  }
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
    const browserFaces = req.body.faces_done === '1';
    const name = cleanText(req.body.name || req.file.originalname, 200);
    const photo = await db.one(
      `insert into photos (event_id, photographer_id, original_name, original_path, sort_key) values ($1, $2, $3, '', $4) returning id`,
      [ev.id, uploader, name, cleanText(req.body.sort_key || name, 200)],
    );
    let stored;
    let key;
    try {
      stored = await saveOriginal({ tmpPath: tmp, eventId: ev.id, photoId: photo.id, originalName: name, sha256: sha });
      key = await renderPhoto({ eventId: ev.id, photoId: photo.id, originalPath: stored.originalPath });
      if (stored.takenAt) await db.query('update photos set taken_at = $2 where id = $1', [photo.id, stored.takenAt]);
    } catch (err) {
      await db.query('delete from photos where id = $1', [photo.id]);
      throw err;
    }
    const year = Number(String(ev.event_date).slice(0, 4));
    let saved = 0;
    for (const f of browserFaces ? faces.slice(0, 60) : []) {
      const buf = encodeDescriptor(f.d);
      if (!buf) continue;
      await db.query('insert into faces (photo_id, event_id, year, descriptor, box) values ($1, $2, $3, $4, $5::jsonb)', [
        photo.id, ev.id, year, buf, JSON.stringify(f.box || null),
      ]);
      saved++;
    }
    await db.query(
      `update photos set original_path = $2, width = $3, height = $4, bytes = $5, sha256 = $6, faces_count = $7, key = $8,
         needs_faces = $9 where id = $1`,
      [photo.id, stored.originalPath, stored.width, stored.height, stored.bytes, stored.sha256, saved, key, !browserFaces],
    );
    if (saved) invalidateFaces();
    res.json({ photo: { ...photoOut({ id: photo.id, event_id: ev.id, width: stored.width, height: stored.height, key }), faces: saved, pending: !browserFaces } });
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
});

// Indexa de novo, no servidor, as fotos do evento em que nenhum rosto foi encontrado.
r.post('/events/:id/reindex', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const r2 = await db.query('update photos set needs_faces = true where event_id = $1 and faces_count = 0', [ev.id]);
  res.json({ ok: true, queued: r2.rowCount ?? r2.affectedRows ?? 0 });
});

// Ocultar/mostrar fotos (uma ou varias): a foto oculta sai do site, da busca por selfie e do carrinho,
// mas continua guardada (e quem ja comprou continua baixando).
r.put('/photos/hidden', async (req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Boolean))].slice(0, 2000);
  if (!ids.length) fail(400, 'Nenhuma foto selecionada.');
  const hidden = !!req.body?.hidden;
  const rows = await db.many(
    `update photos p set hidden = $2 from events e
      where e.id = p.event_id and p.id = any($1::int[]) and ($3::boolean or e.photographer_id = $4) returning p.id`,
    [ids, hidden, req.user.role === 'admin', req.user.id],
  );
  invalidateFaces();
  res.json({ ok: true, changed: rows.length });
});

// Como o grupo aparece no site: so no acervo (selfie), evento so por selfie ou evento com galeria aberta.
r.put('/events/:id/display', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const display = req.body?.display;
  if (!['pool', 'selfie', 'gallery'].includes(display)) fail(400, 'Opção inválida.');
  const categoryId = req.body?.category_id === undefined ? ev.category_id : Number(req.body.category_id) || null;
  if (display !== 'pool' && ev.kind === 'pool' && ev.drive_folder_id) {
    const other = await db.one(`select title from events where drive_folder_id = $1 and id <> $2 and kind = 'event'`, [ev.drive_folder_id, ev.id]);
    if (other) fail(409, `As fotos desta pasta já estão no evento "${other.title}".`);
  }
  await db.query(
    `update events set kind = $2, hide_gallery = $3, category_id = $4,
       status = case when status = 'draft' and $2 = 'event' then 'published' else status end,
       published_at = coalesce(published_at, now())
     where id = $1`,
    [ev.id, display === 'pool' ? 'pool' : 'event', display !== 'gallery', categoryId],
  );
  invalidateFaces();
  res.json({ ok: true });
});

r.delete('/photos/:id', async (req, res) => {
  const p = await db.one('select p.*, e.photographer_id as owner from photos p join events e on e.id = p.event_id where p.id = $1', [Number(req.params.id)]);
  if (!p || (p.owner !== req.user.id && p.photographer_id !== req.user.id && req.user.role !== 'admin')) fail(404, 'Foto não encontrada.');
  const sold = await db.one('select count(*)::int as n from order_items where photo_id = $1', [p.id]);
  if (sold.n) fail(409, 'Esta foto já foi vendida e precisa continuar disponível para o cliente.');
  await db.query('update events set cover_photo_id = null where cover_photo_id = $1', [p.id]);
  await db.query('delete from photos where id = $1', [p.id]);
  await removePhotoFiles(p.event_id, p.id, p.original_path, p.key);
  invalidateFaces();
  res.json({ ok: true });
});

r.get('/sales', async (req, res) => {
  const rows = await db.many(
    `select o.code, o.paid_at, u.name as buyer, e.title as event_title, e.slug as event_slug,
            count(oi.id)::int as photos, sum(oi.price_cents)::int8 as gross_cents, sum(oi.commission_cents)::int8 as commission_cents,
            sum(${myCents()})::int8 as net_cents
       from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
       join users u on u.id = o.user_id join events e on e.id = oi.event_id
      where ${isMine()} and ($2::int is null or oi.event_id = $2)
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

// Regra do cupom: % de desconto, valor em R$ no pedido ou N fotos gratis; com evento, validade e limite de usos.
async function couponRule(req, b) {
  const kind = ['pct', 'fixed', 'free'].includes(b.kind) ? b.kind : 'pct';
  const rule = { kind, pct: null, amount_cents: null, free_photos: null };
  if (kind === 'pct') {
    rule.pct = Math.round(Number(b.pct));
    if (!(rule.pct >= 1 && rule.pct <= 100)) fail(400, 'Desconto entre 1% e 100%.');
  } else if (kind === 'fixed') {
    rule.amount_cents = toCents(b.amount);
    if (!(rule.amount_cents >= 100)) fail(400, 'Valor do desconto: mínimo R$ 1,00.');
  } else {
    rule.free_photos = Math.round(Number(b.free_photos));
    if (!(rule.free_photos >= 1 && rule.free_photos <= 500)) fail(400, 'Quantidade de fotos grátis: de 1 a 500.');
  }
  if (b.event_id) await ownEvent(req, b.event_id);
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  return { ...rule, event_id: Number(b.event_id) || null, max_uses: Number(b.max_uses) || null, starts_at: day(b.starts_at), ends_at: day(b.ends_at) };
}
const insertCoupon = (req, code, r, batch = null, maxUses = r.max_uses) => db.query(
  `insert into coupons (code, photographer_id, event_id, kind, pct, amount_cents, free_photos, max_uses, starts_at, ends_at, batch)
   values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
  [code, req.user.id, r.event_id, r.kind, r.pct, r.amount_cents, r.free_photos, maxUses, r.starts_at, r.ends_at, batch],
);

r.post('/coupons', async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  if (code.length < 3) fail(400, 'Código do cupom: mínimo 3 letras/números.');
  const r = await couponRule(req, b);
  const exists = await db.one('select id from coupons where upper(code) = $1', [code]);
  if (exists) fail(409, 'Já existe um cupom com esse código.');
  await insertCoupon(req, code, r);
  res.json({ ok: true });
});

// Lote: N codigos unicos (PREFIXO-XXXXX), cada um com o limite de usos escolhido (padrao 1). Ex.: um por formando.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
r.post('/coupons/batch', async (req, res) => {
  const b = req.body || {};
  const prefix = String(b.prefix || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (prefix.length < 2) fail(400, 'Prefixo do lote: mínimo 2 letras/números.');
  const count = Math.round(Number(b.count));
  if (!(count >= 1 && count <= 500)) fail(400, 'Quantidade de cupons: de 1 a 500.');
  const r = await couponRule(req, b);
  const batch = `${prefix}-${new Date().toISOString().slice(0, 10)}`;
  const codes = [];
  while (codes.length < count) {
    const code = `${prefix}${Array.from(crypto.randomBytes(5), (x) => ALPHABET[x % ALPHABET.length]).join('')}`;
    if (codes.includes(code) || (await db.one('select 1 from coupons where upper(code) = $1', [code]))) continue;
    await insertCoupon(req, code, r, batch, r.max_uses || 1);
    codes.push(code);
  }
  res.json({ ok: true, batch, codes });
});

r.get('/coupons/batch.csv', async (req, res) => {
  const rows = await db.many('select code, uses, max_uses from coupons where photographer_id = $1 and batch = $2 order by code', [req.user.id, String(req.query.batch || '')]);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="cupons-${String(req.query.batch || 'lote').replace(/[^\w-]/g, '')}.csv"`);
  res.send('\ufeffcodigo;usos;limite\n' + rows.map((c) => `${c.code};${c.uses};${c.max_uses ?? ''}`).join('\n'));
});

r.put('/coupons/:id', async (req, res) => {
  await db.query('update coupons set active = $3 where id = $1 and photographer_id = $2', [Number(req.params.id), req.user.id, !!req.body?.active]);
  res.json({ ok: true });
});

// ---------- Marca d'agua do fotografo ----------

r.get('/watermark', async (req, res) => {
  const p = await db.one('select watermark from photographers where user_id = $1', [req.user.id]);
  const site = normalizeWatermark(await getSetting('watermark', null));
  res.json({ watermark: p?.watermark ? normalizeWatermark(p.watermark) : null, site });
});

r.put('/watermark', async (req, res) => {
  const wm = req.body?.watermark ? normalizeWatermark(req.body.watermark) : null;
  await db.query('update photographers set watermark = $2::jsonb where user_id = $1', [req.user.id, wm ? JSON.stringify(wm) : null]);
  clearWatermarkCache();
  const r2 = await db.query(
    `update photos set needs_render = true where event_id in (select id from events where photographer_id = $1 and watermark_mode = 'photographer')`,
    [req.user.id],
  );
  res.json({ ok: true, rerender: r2.rowCount ?? r2.affectedRows ?? 0 });
});

r.post('/watermark/image', wmUpload.single('file'), async (req, res) => {
  if (!req.file) fail(400, 'Envie o logo em PNG (de preferência com fundo transparente).');
  res.json({ url: await storeAsset(req.file.path, 'marcas', { maxSide: 1200, png: true }) });
});

r.post('/watermark/preview', async (req, res) => {
  const wm = normalizeWatermark(req.body?.watermark);
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'no-store');
  res.end(await watermarkPreview(wm));
});

// ---------- Google Drive ----------

r.get('/drive', async (req, res) => {
  const sources = await db.many(
    `select s.*, c.name as category_name,
            (select count(*) from events e where e.drive_source_id = s.id)::int as events,
            (select count(*) from photos p join events e on e.id = p.event_id where e.drive_source_id = s.id)::int as photos,
            (select count(*) from photos p join events e on e.id = p.event_id where e.drive_source_id = s.id and (p.needs_faces or p.needs_render))::int as pending,
            (select count(*) from drive_skips k where k.source_id = s.id)::int as skipped
       from drive_sources s left join categories c on c.id = s.category_id
      where s.photographer_id = $1 and s.kind = 'year' order by s.year desc, s.id desc`,
    [req.user.id],
  );
  const eventSources = await db.many(
    `select s.id, s.name, s.last_status, s.last_sync_at, s.last_error, s.active, e.id as event_id, e.title as event_title,
            c.name as category_name, (select count(*) from photos p where p.event_id = e.id)::int as photos
       from drive_sources s join events e on e.id = s.event_id left join categories c on c.id = e.category_id
      where s.photographer_id = $1 and s.kind = 'event' order by e.event_date desc`,
    [req.user.id],
  );
  res.json({ info: driveInfo(), sources, eventSources, ignore: await ignoreWords() });
});

function sourceFields(b) {
  const price = toCents(b.price);
  if (price == null || price < 100) fail(400, 'Preço por foto mínimo: R$ 1,00.');
  // Ano opcional: em branco quando a pasta tem varios anos dentro (tudoehfesta/2003..2026/...).
  const year = b.year === '' || b.year == null ? null : Math.round(Number(b.year));
  if (year !== null && !(year >= 1990 && year <= 2100)) fail(400, 'Ano inválido.');
  return {
    year,
    category_id: Number(b.category_id) || null,
    price_cents: price,
    pack_price_cents: toCents(b.pack_price) || null,
    auto_publish: b.auto_publish !== false,
    hide_gallery: !!b.hide_gallery,
    watermark_mode: WM_MODES.includes(b.watermark_mode) ? b.watermark_mode : 'site',
    keep_in_drive: b.keep_in_drive !== false,
  };
}

// Palavras que fazem uma pasta ser ignorada (vale para todas as pastas ligadas; so o admin muda).
r.put('/drive-ignore', async (req, res) => {
  if (req.user.role !== 'admin') fail(403, 'Só o administrador muda esta lista.');
  const words = [...new Set(String(req.body?.words || '').split(/[,;\n]+/)
    .map((w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()).filter((w) => /^[a-z0-9]{2,30}$/.test(w)))].slice(0, 40);
  await setSetting('drive_ignore', words);
  res.json({ ok: true, words });
});

r.post('/drive', async (req, res) => {
  if (!driveInfo().configured) fail(400, 'A integração com o Google Drive ainda não foi configurada no servidor.');
  const folderId = parseFolderId(req.body?.link);
  if (!folderId) fail(400, 'Cole o link de uma pasta do Google Drive.');
  const f = sourceFields(req.body || {});
  const exists = await db.one('select id from drive_sources where photographer_id = $1 and folder_id = $2', [req.user.id, folderId]);
  if (exists) fail(409, 'Essa pasta já está ligada.');
  const name = await folderName(folderId);
  await db.query(
    `insert into drive_sources (photographer_id, folder_id, name, year, category_id, price_cents, pack_price_cents, auto_publish, hide_gallery, watermark_mode, keep_in_drive, last_status, kind)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'na fila', 'year')`,
    [req.user.id, folderId, name, f.year, f.category_id, f.price_cents, f.pack_price_cents, f.auto_publish, f.hide_gallery, f.watermark_mode, f.keep_in_drive],
  );
  res.json({ ok: true, name });
});

async function ownSource(req) {
  const s = await db.one('select * from drive_sources where id = $1', [Number(req.params.id)]);
  if (!s || (s.photographer_id !== req.user.id && req.user.role !== 'admin')) fail(404, 'Pasta não encontrada.');
  return s;
}

r.put('/drive/:id', async (req, res) => {
  const s = await ownSource(req);
  if (req.body?.active !== undefined && Object.keys(req.body).length === 1) {
    await db.query('update drive_sources set active = $2 where id = $1', [s.id, !!req.body.active]);
    return res.json({ ok: true });
  }
  const f = sourceFields(req.body || {});
  await db.query(
    `update drive_sources set year = $2, category_id = $3, price_cents = $4, pack_price_cents = $5, auto_publish = $6,
       hide_gallery = $7, watermark_mode = $8, keep_in_drive = $9 where id = $1`,
    [s.id, f.year, f.category_id, f.price_cents, f.pack_price_cents, f.auto_publish, f.hide_gallery, f.watermark_mode, f.keep_in_drive],
  );
  res.json({ ok: true });
});

r.post('/drive/:id/sync', async (req, res) => {
  const s = await ownSource(req);
  await db.query(`update drive_sources set last_status = 'na fila', active = true where id = $1 and coalesce(last_status, '') <> 'sincronizando'`, [s.id]);
  res.json({ ok: true });
});

r.get('/drive/:id/preview', async (req, res) => {
  const s = await ownSource(req);
  res.json(await previewSource(s));
});

r.get('/drive/:id/skips', async (req, res) => {
  const s = await ownSource(req);
  res.json({ skips: await db.many('select name, reason, created_at from drive_skips where source_id = $1 order by created_at desc limit 300', [s.id]) });
});

// Esquece as recusas: na proxima rodada esses arquivos sao revisados de novo (ex.: depois de trocar o arquivo).
r.delete('/drive/:id/skips', async (req, res) => {
  const s = await ownSource(req);
  await db.query('delete from drive_skips where source_id = $1', [s.id]);
  res.json({ ok: true });
});

r.delete('/drive/:id', async (req, res) => {
  const s = await ownSource(req);
  await db.query('update events set drive_source_id = null, auto_publish = false where drive_source_id = $1', [s.id]);
  await db.query('delete from drive_sources where id = $1', [s.id]);
  res.json({ ok: true });
});

// ---------- Pasta do Drive de um evento especifico (ex.: formatura com a pasta propria) ----------

// Junta as fotos de um evento (normalmente do acervo do ano) neste evento cadastrado: fotos, rostos, vendas e
// sugestoes vao junto; a vitrine e refeita com a marca d'agua deste evento. Nada e duplicado.
async function mergeInto(other, ev) {
  const marks = await db.many('select id, watermark_mode, photographer_id from events where id = any($1::int[])', [[other.id, ev.id]]);
  const [a, b] = [marks.find((m) => m.id === other.id), marks.find((m) => m.id === ev.id)];
  const sameMark = a && b && a.watermark_mode === b.watermark_mode && a.photographer_id === b.photographer_id;
  const photos = await db.many('select id, key from photos where event_id = $1 and key is not null', [other.id]);
  await db.tx(async (t) => {
    await t.query('update events set drive_folder_id = null where id = $1', [other.id]);
    await t.query('update photos set event_id = $2 where event_id = $1', [other.id, ev.id]);
    await t.query('update faces set event_id = $2, year = $3 where event_id = $1', [other.id, ev.id, Number(String(ev.event_date).slice(0, 4))]);
    await t.query('update order_items set event_id = $2 where event_id = $1', [other.id, ev.id]);
    await t.query('delete from drive_sources where event_id = $1', [other.id]);
    await t.query('delete from events where id = $1', [other.id]);
  });
  // As previas so mudam de pasta (rapido, sem baixar do Drive); refaz apenas se a marca d'agua for outra.
  const redo = [];
  for (const p of photos) if (!sameMark || !(await movePhotoFiles(other.id, ev.id, p.id, p.key))) redo.push(p.id);
  if (redo.length) await db.query('update photos set needs_render = true where id = any($1::int[])', [redo]);
  if (!sameMark) await Promise.all(photos.map((p) => movePhotoFiles(other.id, ev.id, p.id, p.key)));
  await Promise.all(['p', 't'].map((v) => fsp.rm(path.join(dirs.public, v, String(other.id)), { recursive: true, force: true })));
  invalidateFaces();
}

// Visao do acervo por ano: o que esta no site, de onde veio e quanto vendeu (controle do fotografo/admin).
const GROUP_STATS = `
  (select count(*) from photos p where p.event_id = e.id and (p.needs_faces or p.needs_render or p.key is null))::int as pending,
  (select count(*) from photos p where p.event_id = e.id and p.hidden)::int as hidden_count,
  (select coalesce(sum(p.faces_count), 0) from photos p where p.event_id = e.id)::int as faces,
  (select count(*) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where oi.event_id = e.id)::int as sold,
  (select coalesce(sum(oi.price_cents), 0) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where oi.event_id = e.id)::int as sold_cents`;
r.get('/acervo', async (req, res) => {
  const scope = [req.user.role === 'admin', req.user.id];
  const years = await db.many(
    `select y as year, count(*) filter (where kind = 'pool')::int as groups, count(*) filter (where kind = 'event')::int as events,
            sum(photo_count)::int as photos, sum(faces)::int as faces, sum(pending)::int as pending, sum(sold)::int as sold, sum(sold_cents)::int as sold_cents, sum(hidden_count)::int as hidden
       from (select e.kind, extract(year from e.event_date)::int as y,
                    (select count(*) from photos p where p.event_id = e.id and p.key is not null and not p.hidden)::int as photo_count, ${GROUP_STATS}
               from events e where ($1::boolean or e.photographer_id = $2)) x
      group by y order by y desc`,
    scope,
  );
  const year = Number(req.query.year) || years[0]?.year;
  const groups = year ? await db.many(
    `select ${EVENT_CARD}, e.drive_folder_path, e.drive_folder_id, e.cover_photo_id, (select min(p.tag) from photos p where p.event_id = e.id) as tag, ${GROUP_STATS}
       ${EVENT_JOINS}
      where ($1::boolean or e.photographer_id = $2) and e.event_date >= make_date($3, 1, 1) and e.event_date < make_date($3 + 1, 1, 1)
      order by e.event_date desc, e.id desc`,
    [...scope, year],
  ) : [];
  res.json({ years, year, groups: groups.map(eventCard) });
});

// ----- Equipe do evento (varios fotografos) -----
// Fotografos aprovados, pelo nome (ou pelo e-mail completo), para chamar como parceiro num evento.
r.get('/photographers/search', async (req, res) => {
  const q = cleanText(req.query.q, 80);
  if (!q || q.length < 2) return res.json({ photographers: [] });
  const rows = await db.many(
    `select u.id, ph.display_name, ph.slug, ph.city, ph.avatar_path from photographers ph join users u on u.id = ph.user_id
      where ph.status = 'approved' and u.id <> $2
        and (ph.display_name ilike '%' || $1 || '%' or u.name ilike '%' || $1 || '%' or lower(u.email) = lower($1))
      order by ph.display_name limit 10`,
    [q, req.user.id],
  );
  res.json({ photographers: rows });
});

r.get('/events/:id/team', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const stats = `(select count(*) from photos p where p.event_id = $1 and p.photographer_id = u.id)::int as photos,
          (select count(*) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where oi.event_id = $1 and oi.photographer_id = u.id)::int as sold,
          (select coalesce(sum(oi.price_cents), 0) from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where oi.event_id = $1 and oi.photographer_id = u.id)::int as cents`;
  const members = await db.many(
    `select u.id, u.name, u.email, ph.display_name, t.max_photos, t.upload_until, t.added_at, ${stats}
       from event_team t join users u on u.id = t.user_id left join photographers ph on ph.user_id = u.id
      where t.event_id = $1 order by t.added_at`,
    [ev.id],
  );
  const owner = await db.one(
    `select u.id, u.name, u.email, ph.display_name, ${stats} from users u left join photographers ph on ph.user_id = u.id where u.id = $2`,
    [ev.id, ev.photographer_id],
  );
  const organizerCents = await db.one(
    `select coalesce(sum(oi.organizer_cents), 0)::int as c from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where oi.event_id = $1`,
    [ev.id],
  );
  res.json({ owner, members, organizer_pct: ev.organizer_pct, organizer_cents: organizerCents.c });
});

const teamLimits = (b) => ({
  max_photos: Number(b.max_photos) > 0 ? Math.round(Number(b.max_photos)) : null,
  upload_until: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(b.upload_until || '')) ? `${b.upload_until}:00-03:00` : null,
});

r.post('/events/:id/team', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  if (!ev.accepts_partners) fail(400, 'Marque “Aceita parcerias” no evento primeiro.');
  // Pelo cadastro escolhido na busca (user_id) ou pelo e-mail.
  const email = String(req.body?.email || '').trim().toLowerCase();
  const u = await db.one(
    `select u.id, u.role, ph.status from users u left join photographers ph on ph.user_id = u.id where ${req.body?.user_id ? 'u.id = $1' : 'u.email = $1'}`,
    [req.body?.user_id ? Number(req.body.user_id) : email],
  );
  if (!u) fail(404, 'Não achamos uma conta com este e-mail. Peça para a pessoa se cadastrar em "Seja fotógrafo" primeiro.');
  if (u.id === ev.photographer_id) fail(400, 'Você já é o dono do evento.');
  if (u.role !== 'admin' && !(u.role === 'photographer' && u.status === 'approved')) fail(400, 'Esta conta ainda não é de fotógrafo aprovado.');
  const l = teamLimits(req.body || {});
  await db.query(
    `insert into event_team (event_id, user_id, max_photos, upload_until) values ($1, $2, $3, $4)
     on conflict (event_id, user_id) do update set max_photos = excluded.max_photos, upload_until = excluded.upload_until`,
    [ev.id, u.id, l.max_photos, l.upload_until],
  );
  res.json({ ok: true });
});

r.put('/events/:id/team/:userId', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const l = teamLimits(req.body || {});
  await db.query('update event_team set max_photos = $3, upload_until = $4 where event_id = $1 and user_id = $2', [ev.id, Number(req.params.userId), l.max_photos, l.upload_until]);
  res.json({ ok: true });
});

// Sair da equipe nao apaga nada: as fotos continuam no evento e continuam sendo do fotografo.
r.delete('/events/:id/team/:userId', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  await db.query('delete from event_team where event_id = $1 and user_id = $2', [ev.id, Number(req.params.userId)]);
  // A pasta do Drive que a pessoa ligou ao evento deixa de importar.
  await db.query('delete from drive_sources where event_id = $1 and photographer_id = $2', [ev.id, Number(req.params.userId)]);
  res.json({ ok: true });
});

r.put('/events/:id/organizer', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const pct = Math.max(0, Math.min(50, Math.round(Number(req.body?.organizer_pct) || 0)));
  await db.query('update events set organizer_pct = $2 where id = $1', [ev.id, pct]);
  res.json({ ok: true, organizer_pct: pct });
});

// Desempenho de um evento: visitas, conversao, vendas nos primeiros 30 dias, horario das vendas,
// melhores clientes e cupons usados.
r.get('/events/:id/insights', async (req, res) => {
  const ev = await ownEvent(req, req.params.id);
  const BR = (col) => `(${col} at time zone 'UTC' - interval '3 hours')`;
  const paid = `from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where oi.event_id = $1`;
  const [t, first30, byHour, top, coupons] = await Promise.all([
    db.one(
      `select (select count(*) from visits where event_id = $1)::int as visits,
              (select count(distinct visitor) from visits where event_id = $1)::int as visitors,
              (select count(*) from photos where event_id = $1 and key is not null and not hidden)::int as photo_count,
              (select count(distinct o.id) ${paid})::int as orders,
              (select count(distinct oi.photo_id) ${paid})::int as photos_sold,
              (select coalesce(sum(oi.price_cents), 0) ${paid})::int as cents,
              (select coalesce(sum(oi.photographer_cents), 0) ${paid})::int as net_cents`,
      [ev.id],
    ),
    db.many(
      `select (${BR('o.paid_at')}::date - $2::date) as d, coalesce(sum(oi.price_cents), 0)::int as cents
         ${paid} and ${BR('o.paid_at')}::date between $2::date and $2::date + 29 group by 1 order by 1`,
      [ev.id, String(ev.event_date).slice(0, 10)],
    ),
    db.many(`select extract(hour from ${BR('o.paid_at')})::int as h, count(distinct o.id)::int as orders ${paid} group by 1`, [ev.id]),
    db.many(
      `select u.name, coalesce(sum(oi.price_cents), 0)::int as cents, count(*)::int as photos
         from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' join users u on u.id = o.user_id
        where oi.event_id = $1 group by u.id order by cents desc limit 5`,
      [ev.id],
    ),
    db.many(
      `select o.coupon_code as code, count(distinct o.id)::int as uses from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
        where oi.event_id = $1 and o.coupon_code is not null group by 1 order by 2 desc limit 5`,
      [ev.id],
    ),
  ]);
  let acc = 0;
  const cumulative = Array.from({ length: 30 }, (_, d) => { acc += first30.find((r) => Number(r.d) === d)?.cents || 0; return acc; });
  const shortName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };
  res.json({
    ...t,
    pct_sold: t.photo_count ? t.photos_sold / t.photo_count : 0,
    ticket_cents: t.orders ? Math.round(t.cents / t.orders) : 0,
    conversion: t.visitors ? t.orders / t.visitors : 0,
    first30: cumulative,
    byHour: Array.from({ length: 24 }, (_, h) => byHour.find((r) => r.h === h)?.orders || 0),
    topClients: top.map((c) => ({ name: shortName(c.name), cents: c.cents, photos: c.photos })),
    coupons,
  });
});

// Acervo do ano (pastas importadas pela pasta geral), para escolher a tag ao cadastrar um evento.
r.get('/pool', async (req, res) => {
  const q = cleanText(req.query.q, 80);
  const rows = await db.many(
    `select ${EVENT_CARD}, e.drive_folder_path,
            (select min(p.tag) from photos p where p.event_id = e.id) as tag
       ${EVENT_JOINS}
      where e.kind = 'pool' and ($1::boolean or e.photographer_id = $2)
        and ($3::text is null or e.title ilike '%' || $3 || '%' or e.drive_folder_path ilike '%' || $3 || '%')
      order by e.event_date desc, e.id desc limit 100`,
    [req.user.role === 'admin', req.user.id, q],
  );
  res.json({ pool: rows.map(eventCard) });
});

// Puxa para este evento as fotos marcadas com a tag escolhida (um grupo do acervo).
r.post('/events/:id/attach', async (req, res) => {
  const { ev, role, member } = await teamEvent(req, req.params.id);
  if (ev.kind === 'pool') fail(400, 'Este já é um grupo do acervo. Cadastre um evento e puxe as fotos para ele.');
  const other = await db.one(`select id, title, drive_folder_id, drive_folder_path, photographer_id from events where id = $1 and kind = 'pool'`, [Number(req.body?.pool_event_id)]);
  if (!other || (other.photographer_id !== req.user.id && (role === 'team' || req.user.role !== 'admin'))) fail(404, 'Grupo do acervo não encontrado.');
  if (role === 'team') {
    // O parceiro so traz as fotos; a pasta do evento continua sendo a do dono.
    const n = (await db.one('select count(*)::int as n from photos where event_id = $1', [other.id])).n;
    await checkTeamRoom(ev, member, req.user.id, n);
    await mergeInto(other, ev);
    // Fotos novas que o parceiro colocar depois nessa pasta tambem vem para o evento.
    if (other.drive_folder_id) await linkPartnerFolder(ev, req.user.id, other.drive_folder_id, other.drive_folder_path || other.title, true, false);
    return res.json({ ok: true, photos: n, from: other.drive_folder_path || other.title });
  }
  if (ev.drive_folder_id && other.drive_folder_id && ev.drive_folder_id !== other.drive_folder_id) {
    fail(409, 'Este evento já está ligado a outra pasta. Desligue a pasta atual antes.');
  }
  const photos = await db.one('select count(*)::int as n from photos where event_id = $1', [other.id]);
  await mergeInto(other, ev);
  await db.query('update events set drive_folder_id = coalesce(drive_folder_id, $2), drive_folder_path = coalesce($3, drive_folder_path) where id = $1',
    [ev.id, other.drive_folder_id, other.drive_folder_path]);
  res.json({ ok: true, photos: photos.n, from: other.drive_folder_path || other.title });
});

r.get('/events/:id/drive', async (req, res) => {
  const { ev, role } = await teamEvent(req, req.params.id);
  const me = role === 'owner' ? ev.photographer_id : req.user.id;
  const SRC = `s.*, (select count(*) from photos p where p.event_id = s.event_id and p.photographer_id = s.photographer_id)::int as photos,
            (select count(*) from photos p where p.event_id = s.event_id and p.photographer_id = s.photographer_id and (p.needs_faces or p.needs_render))::int as pending,
            (select count(*) from drive_skips k where k.source_id = s.id)::int as skipped`;
  const s = await db.one(`select ${SRC} from drive_sources s where s.event_id = $1 and s.photographer_id = $2`, [ev.id, me]);
  // O dono ve tambem as pastas que os parceiros ligaram.
  const partners = role === 'owner' ? await db.many(
    `select ${SRC}, coalesce(ph.display_name, u.name) as photographer_name from drive_sources s join users u on u.id = s.photographer_id
       left join photographers ph on ph.user_id = s.photographer_id where s.event_id = $1 and s.photographer_id <> $2 order by s.id`,
    [ev.id, ev.photographer_id],
  ) : [];
  res.json({
    info: driveInfo(), role, source: s, partners, kind: ev.kind,
    folder_id: role === 'owner' ? ev.drive_folder_id : s?.folder_id || null,
    folder_path: role === 'owner' ? ev.drive_folder_path : s?.name || null,
    photos: (await db.one(`select count(*)::int as n from photos where event_id = $1 and ($2::int is null or photographer_id = $2)`, [ev.id, role === 'team' ? req.user.id : null])).n,
  });
});

// Pasta do Drive do parceiro ligada ao evento (uma por fotografo). replace = trocar a pasta que ele ja tinha ligado.
async function linkPartnerFolder(ev, userId, folderId, name, keepInDrive, replace) {
  await db.query(
    `insert into drive_sources (photographer_id, folder_id, name, year, kind, event_id, category_id, price_cents, pack_price_cents,
       auto_publish, hide_gallery, watermark_mode, keep_in_drive, last_status)
     values ($1, $2, $3, $4, 'event', $5, $6, $7, $8, false, $9, $10, $11, 'na fila')
     on conflict (event_id, photographer_id) where event_id is not null do ${replace
       ? "update set folder_id = excluded.folder_id, name = excluded.name, active = true, last_status = 'na fila', last_error = null"
       : 'nothing'}`,
    [userId, folderId, name, Number(String(ev.event_date).slice(0, 4)), ev.id, ev.category_id, ev.price_cents,
      ev.pack_price_cents, ev.hide_gallery, ev.watermark_mode, keepInDrive],
  );
}

// Parceiro: dentro do prazo e do limite de fotos combinados com o dono do evento.
async function checkTeamRoom(ev, member, userId, adding = 0) {
  if (member.upload_until && new Date(member.upload_until) < new Date()) fail(403, 'O prazo de envio deste evento terminou.');
  if (member.max_photos) {
    const n = (await db.one('select count(*)::int as n from photos where event_id = $1 and photographer_id = $2', [ev.id, userId])).n;
    if (n + adding > member.max_photos) fail(403, `O limite combinado é de ${member.max_photos} fotos (você já tem ${n} neste evento).`);
  }
}

r.post('/events/:id/drive', async (req, res) => {
  const { ev, role, member } = await teamEvent(req, req.params.id);
  if (!driveInfo().configured) fail(400, 'A integração com o Google Drive ainda não foi configurada no servidor.');
  const folderId = parseFolderId(req.body?.link);
  if (!folderId) fail(400, 'Cole o link de uma pasta do Google Drive.');
  const taken = await db.one('select photographer_id from drive_sources where event_id = $1 and folder_id = $2 and photographer_id <> $3', [ev.id, folderId, role === 'owner' ? ev.photographer_id : req.user.id]);
  if (taken || (role === 'team' && ev.drive_folder_id === folderId)) fail(409, 'Essa pasta já está ligada a este evento por outro fotógrafo.');
  if (role === 'team') {
    await checkTeamRoom(ev, member, req.user.id);
    const name = await folderName(folderId);
    // Fotos dessa pasta que ja estavam no acervo do proprio parceiro vem para o evento.
    const own = await db.one(`select id, title, drive_folder_path from events where drive_folder_id = $1 and kind = 'pool' and photographer_id = $2`, [folderId, req.user.id]);
    if (own) await mergeInto(own, ev);
    await linkPartnerFolder(ev, req.user.id, folderId, name, req.body?.keep_in_drive !== false, true);
    return res.json({ ok: true, name, merged: own ? own.title : null });
  }
  const name = await folderName(folderId);
  const other = await db.one('select id, title, drive_folder_path from events where drive_folder_id = $1 and id <> $2', [folderId, ev.id]);
  if (other) await mergeInto(other, ev);
  await db.query('update events set drive_folder_id = $2, drive_folder_path = coalesce($3, drive_folder_path, $4) where id = $1', [ev.id, folderId, other?.drive_folder_path || null, name]);
  await db.query(
    `insert into drive_sources (photographer_id, folder_id, name, year, kind, event_id, category_id, price_cents, pack_price_cents,
       auto_publish, hide_gallery, watermark_mode, keep_in_drive, last_status)
     values ($1, $2, $3, $4, 'event', $5, $6, $7, $8, false, $9, $10, $11, 'na fila')
     on conflict (event_id, photographer_id) where event_id is not null do update set folder_id = excluded.folder_id, name = excluded.name,
       active = true, last_status = 'na fila', last_error = null`,
    [ev.photographer_id, folderId, name, Number(String(ev.event_date).slice(0, 4)), ev.id, ev.category_id, ev.price_cents,
      ev.pack_price_cents, ev.hide_gallery, ev.watermark_mode, req.body?.keep_in_drive !== false],
  );
  res.json({ ok: true, name, merged: other ? other.title : null });
});

// Desliga a pasta: o parceiro desliga a dele; o dono desliga a propria ou (?user=) a de um parceiro.
// As fotos ja importadas continuam no evento.
r.delete('/events/:id/drive', async (req, res) => {
  const { ev, role } = await teamEvent(req, req.params.id);
  if (role === 'team') {
    await db.query('delete from drive_sources where event_id = $1 and photographer_id = $2', [ev.id, req.user.id]);
    return res.json({ ok: true });
  }
  const who = req.query.user ? Number(req.query.user) : ev.photographer_id;
  await db.query('delete from drive_sources where event_id = $1 and photographer_id = $2', [ev.id, who]);
  if (who === ev.photographer_id && req.query.release === '1') await db.query('update events set drive_folder_id = null, drive_folder_path = null where id = $1', [ev.id]);
  res.json({ ok: true });
});

export default r;
