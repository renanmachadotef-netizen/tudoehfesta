import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { db } from './db.js';
import { renderPhoto, originalAbsPath } from './storage.js';
import { encodeDescriptor, invalidateFaces } from './faces.js';
import { syncDueSources } from './drive.js';

// Fila em segundo plano guardada no proprio banco (sobrevive a reinicios):
//   photos.needs_render -> refazer vitrine/miniatura (marca d'agua mudou, foto importada)
//   photos.needs_faces  -> indexar rostos no servidor (importacao do Drive ou upload sem rostos)
// Depois publica os eventos importados do Drive que estavam esperando ficar prontos.

const here = path.dirname(fileURLToPath(import.meta.url));
let worker = null;
let seq = 0;
const pending = new Map();

function faceWorker() {
  if (!worker) {
    worker = new Worker(path.join(here, 'face-worker.cjs'));
    worker.on('message', ({ id, faces, error }) => {
      const p = pending.get(id);
      pending.delete(id);
      if (p) error ? p.reject(new Error(error)) : p.resolve(faces);
    });
    worker.on('error', (err) => {
      console.error('[rostos] thread caiu:', err.message);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = null;
    });
  }
  return worker;
}

export function detectFacesOnServer(file) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    faceWorker().postMessage({ id, file });
  });
}

async function renderBatch() {
  const rows = await db.many(
    `select id, event_id, original_path, key from photos where needs_render and original_path <> '' order by id limit 6`,
  );
  for (const p of rows) {
    try {
      const key = await renderPhoto({ eventId: p.event_id, photoId: p.id, originalPath: p.original_path, oldKey: p.key });
      await db.query('update photos set key = $2, needs_render = false where id = $1', [p.id, key]);
    } catch (err) {
      console.error('[vitrine] foto', p.id, err.message);
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
      faces = await detectFacesOnServer(originalAbsPath(p.original_path));
    } catch (err) {
      console.error('[rostos] foto', p.id, err.message);
    }
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

// "O sistema revisa e publica": evento importado do Drive vai ao ar quando todas as fotos estao prontas.
async function autoPublish() {
  const rows = await db.many(
    `update events e set status = 'published', published_at = now(), auto_publish = false
      where e.auto_publish and e.status = 'draft'
        and exists (select 1 from photos p where p.event_id = e.id)
        and not exists (select 1 from photos p where p.event_id = e.id and (p.needs_faces or p.needs_render))
        and not exists (select 1 from drive_sources s where s.id = e.drive_source_id
                         and (s.last_status = 'sincronizando' or s.last_status like 'continuando%'))
      returning e.id, e.title`,
  );
  for (const r of rows) console.log('[publicacao] evento publicado automaticamente:', r.title);
  if (rows.length) invalidateFaces();
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const rendered = await renderBatch();
    const indexed = await facesBatch();
    await autoPublish();
    // Fila vazia: hora de procurar fotos novas no Drive.
    if (!rendered && !indexed) await syncDueSources();
  } catch (err) {
    console.error('[fila]', err);
  } finally {
    busy = false;
  }
}

export function startJobs() {
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
