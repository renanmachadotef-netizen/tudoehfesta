import { db } from './db.js';
import { renderPhoto } from './storage.js';
import { detectFacesOnServer } from './facepool.js';
import { withOriginal, isDriveOriginal, copyToServer } from './originals.js';
import { encodeDescriptor, invalidateFaces } from './faces.js';
import { syncDueSources } from './drive.js';
import { pollPendingInfinitePay, checkInfinitePay } from './infinitepay.js';
import { matchBatch, blurBoxesFor } from './matching.js';
import { activity, count } from './activity.js';

// Fila em segundo plano guardada no proprio banco (sobrevive a reinicios):
//   photos.needs_render -> refazer vitrine/miniatura (marca d'agua mudou, foto importada)
//   photos.needs_faces  -> indexar rostos no servidor (importacao do Drive ou upload sem rostos)
//   rostos novos x rostos cadastrados pelos clientes -> "Encontradas para voce" e borrao (matching.js)
// Depois publica os eventos importados do Drive que estavam esperando ficar prontos.

async function renderBatch() {
  const rows = await db.many(
    `select id, event_id, original_path, key from photos where needs_render and original_path <> '' order by id limit 6`,
  );
  for (const p of rows) {
    try {
      const blurBoxes = await blurBoxesFor(p.id);
      const key = await withOriginal(p.original_path, (srcFile) => renderPhoto({ eventId: p.event_id, photoId: p.id, oldKey: p.key, srcFile, blurBoxes }));
      await db.query('update photos set key = $2, needs_render = false where id = $1', [p.id, key]);
      count('render');
    } catch (err) {
      console.error('[vitrine] foto', p.id, err.message);
      activity('erro', `Prévia da foto #${p.id}: ${err.message}`);
      await db.query('update photos set needs_render = false where id = $1', [p.id]);
    }
  }
  return rows.length;
}

async function facesBatch() {
  const rows = await db.many(
    `select p.id, p.event_id, p.original_path, extract(year from e.event_date)::int as year
       from photos p join events e on e.id = p.event_id
      where p.needs_faces and p.original_path <> '' order by p.id limit 4`,
  );
  for (const p of rows) {
    let faces = [];
    try {
      faces = await withOriginal(p.original_path, (file) => detectFacesOnServer(file));
    } catch (err) {
      console.error('[rostos] foto', p.id, err.message);
      activity('erro', `Rostos da foto #${p.id}: ${err.message}`);
    }
    count('scan');
    count('faces', Math.min(faces.length, 60));
    await db.tx(async (t) => {
      await t.query('delete from faces where photo_id = $1', [p.id]);
      for (const f of faces.slice(0, 60)) {
        const buf = encodeDescriptor(f.d);
        if (buf) await t.query('insert into faces (photo_id, event_id, year, descriptor, box) values ($1, $2, $3, $4, $5::jsonb)', [p.id, p.event_id, p.year, buf, JSON.stringify(f.box)]);
      }
      await t.query('update photos set needs_faces = false, faces_count = $2 where id = $1', [p.id, faces.length]);
    });
  }
  if (rows.length) invalidateFaces();
  return rows.length;
}

// Fotos vendidas cujo original esta so no Drive: copia para o servidor (o cliente nao depende mais do Drive).
async function copyBatch() {
  const rows = await db.many(`select id, event_id, original_path, original_name from photos where needs_copy order by id limit 4`);
  for (const p of rows) {
    try {
      if (isDriveOriginal(p.original_path)) {
        const rel = await copyToServer(p.event_id, p.id, p.original_path, p.original_name);
        await db.query('update photos set original_path = $2, needs_copy = false where id = $1', [p.id, rel]);
        activity('copia', `Original vendido copiado do Drive para o servidor (foto #${p.id})`);
      } else {
        await db.query('update photos set needs_copy = false where id = $1', [p.id]);
      }
    } catch (err) {
      // Continua marcada: tenta de novo na proxima volta (Drive fora do ar, por exemplo).
      console.error('[copia] foto', p.id, err.message);
      activity('erro', `Cópia do original #${p.id}: ${err.message}`);
    }
  }
  return rows.length;
}

// Pedidos aguardando pagamento ha mais de 7 dias sao cancelados (antes, uma ultima conferencia na InfinitePay).
let lastExpire = 0;
async function expirePending() {
  if (Date.now() - lastExpire < 10 * 60_000) return;
  lastExpire = Date.now();
  const rows = await db.many(`select * from orders where status = 'pending' and created_at < now() - interval '7 days' limit 50`);
  for (const o of rows) {
    if (o.payment_provider === 'infinitepay' && o.ip_transaction_nsu) {
      const after = await checkInfinitePay(o).catch(() => o);
      if (after.status === 'paid') continue;
    }
    await db.query(`update orders set status = 'cancelled' where id = $1 and status = 'pending'`, [o.id]);
    console.log('[pedido] cancelado por falta de pagamento (7 dias):', o.code);
    activity('pedido', `Pedido ${o.code} cancelado: 7 dias sem pagamento`);
  }
}

// "O sistema revisa e publica": evento importado do Drive vai ao ar quando todas as fotos estao prontas.
async function autoPublish() {
  const rows = await db.many(
    `update events e set status = 'published', published_at = now(), auto_publish = false
      where e.auto_publish and e.status = 'draft'
        and exists (select 1 from photos p where p.event_id = e.id)
        and not exists (select 1 from photos p where p.event_id = e.id and (p.needs_faces or p.needs_render))
        and not exists (select 1 from drive_sources s where s.id = e.drive_source_id
                         and (s.last_status = 'sincronizando' or s.last_status like 'continuando%'))
      returning e.id, e.title, e.kind`,
  );
  for (const r of rows) {
    console.log('[publicacao] evento publicado automaticamente:', r.title);
    activity('publicacao', r.kind === 'pool' ? `Acervo liberado para a busca por selfie: ${r.title}` : `Evento publicado: ${r.title}`);
  }
  if (rows.length) invalidateFaces();
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    await copyBatch();
    await pollPendingInfinitePay().catch((err) => console.warn('[infinitepay]', err.message));
    await expirePending();
    const rendered = await renderBatch();
    const indexed = await facesBatch();
    await matchBatch();
    await autoPublish();
    // Fila vazia: hora de procurar fotos novas no Drive.
    if (!rendered && !indexed) await syncDueSources();
  } catch (err) {
    console.error('[fila]', err);
    activity('erro', `Fila: ${err.message}`);
  } finally {
    busy = false;
  }
}

export function startJobs() {
  // Sincronizacao interrompida por um reinicio (deploy) volta para a fila em vez de ficar presa.
  db.query(`update drive_sources set last_status = 'na fila' where last_status = 'sincronizando'`).catch(() => {});
  setInterval(tick, 4000).unref();
  setTimeout(tick, 2000);
}

export async function queueStatus(where = 'true', params = []) {
  return db.one(
    `select count(*) filter (where needs_render)::int as render, count(*) filter (where needs_faces)::int as faces
       from photos p where ${where}`,
    params,
  );
}
