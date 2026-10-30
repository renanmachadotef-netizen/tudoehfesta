import { db } from './db.js';
import { renderPhoto, relocateOrphanPreviews, sweepOrphans } from './storage.js';
import { detectFacesOnServer } from './facepool.js';
import { withOriginal, withFaceSource, cleanFaceCache, isDriveOriginal, copyToServer } from './originals.js';
import { saveFaces, invalidateFaces, migrateFaceModel, FACE_MODEL } from './faces.js';
import { FACE_THREADS } from './facepool.js';
import { syncDueSources } from './drive.js';
import { pollPendingInfinitePay, checkInfinitePay } from './infinitepay.js';
import { matchBatch, blurPlanFor } from './matching.js';
import { learnBatch } from './learn.js';
import { activity, count, progress } from './activity.js';
import { readBibs } from './bibs.js';

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
      const plan = await blurPlanFor(p.id);
      const key = await withOriginal(p.original_path, (srcFile) => renderPhoto({
        eventId: p.event_id, photoId: p.id, oldKey: p.key, srcFile, blurBoxes: plan.boxes, privateFor: plan.privateFor,
      }));
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

// Rostos: fila continua. Mantem cada thread do reconhecimento facial ocupada (2 fotos por thread na fila);
// quando uma foto termina, a proxima entra na hora, sem esperar as outras.
const facesInFlight = new Set();
// Uma reposicao de cada vez (duas ao mesmo tempo poderiam pegar a mesma foto duas vezes).
let facesFillChain = Promise.resolve();
function facesFill() {
  facesFillChain = facesFillChain.then(facesFillOnce, facesFillOnce);
  return facesFillChain;
}
async function facesFillOnce() {
  const room = FACE_THREADS * 2 - facesInFlight.size;
  if (room <= 0) return;
  const rows = await db.many(
    `select p.id, p.event_id, p.original_path, extract(year from e.event_date)::int as year
       from photos p join events e on e.id = p.event_id
      where p.needs_faces and p.original_path <> '' and not (p.id = any($2::int[])) order by p.id limit $1`,
    [room, [...facesInFlight]],
  );
  for (const p of rows) {
    facesInFlight.add(p.id);
    facesOne(p)
      .catch((err) => { console.error('[rostos]', err); activity('erro', `Rostos: ${err.message}`); })
      .finally(() => { facesInFlight.delete(p.id); facesFill().catch(() => {}); });
  }
}
async function facesOne(p) {
  let faces = [];
  try {
    faces = await withFaceSource(p, (file) => detectFacesOnServer(file));
  } catch (err) {
    console.error('[rostos] foto', p.id, err.message);
    activity('erro', `Rostos da foto #${p.id}: ${err.message}`);
  }
  count('scan');
  count('faces', faces.length);
  await db.tx(async (t) => {
    const saved = await saveFaces(t, p, faces);
    await t.query('update photos set needs_faces = false, faces_redo = false, faces_count = $2 where id = $1', [p.id, saved]);
  });
  invalidateFaces();
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
// Algum cliente pediu "borrar minhas imagens": fotos novas esperam a checagem de rosto antes de aparecer.
const BLUR_WATCH = 'exists (select 1 from users bu where bu.blur_me)';

async function autoPublish() {
  // Liberacao agendada: rascunho com data marcada vai ao ar sozinho.
  const scheduled = await db.many(
    `update events set status = 'published', published_at = now(), publish_at = null
      where status = 'draft' and publish_at is not null and publish_at <= now() returning id, title`,
  );
  for (const r of scheduled) activity('publicacao', `Evento publicado no horário agendado: ${r.title}`);
  if (scheduled.length) invalidateFaces();
  const rows = await db.many(
    `update events e set status = 'published', published_at = now(), auto_publish = false
      where e.auto_publish and e.status = 'draft'
        and exists (select 1 from photos p where p.event_id = e.id)
        and not exists (select 1 from photos p where p.event_id = e.id and (p.needs_render or (p.needs_faces and not p.faces_redo and ${BLUR_WATCH})))
        -- Evento cadastrado: espera a pasta dele terminar. Acervo: libera cada pasta assim que as fotos dela
        -- estao prontas (a pasta geral pode levar horas); so a que esta sendo importada agora espera.
        and (case when e.kind = 'pool'
                  then e.drive_folder_path is distinct from $1
                  else not exists (select 1 from drive_sources s where s.id = e.drive_source_id
                                    and (s.last_status in ('sincronizando', 'na fila') or s.last_status like 'continuando%'))
             end)
      returning e.id, e.title, e.kind`,
    [progress.sync?.folder || null],
  );
  for (const r of rows) {
    console.log('[publicacao] evento publicado automaticamente:', r.title);
    activity('publicacao', r.kind === 'pool' ? `Acervo liberado para a busca por selfie: ${r.title}` : `Evento publicado: ${r.title}`);
  }
  if (rows.length) invalidateFaces();
}

let busy = false;
// Numero de peito: le as fotos dos eventos com a busca por numero ligada (depois dos rostos, que ajudam a
// achar o peito). Duas por volta, so quando a fila de previas e rostos esta vazia.
async function bibBatch() {
  const rows = await db.many(
    `select p.id, p.event_id, p.original_path from photos p join events e on e.id = p.event_id and e.bib_search
      where not p.bib_done and p.key is not null and not p.needs_faces and p.original_path <> '' order by p.id limit 2`,
  );
  for (const p of rows) {
    let bibs = [];
    try {
      const boxes = (await db.many('select box from faces where photo_id = $1 and box is not null', [p.id])).map((r) => r.box);
      bibs = await withOriginal(p.original_path, (file) => readBibs(file, boxes));
    } catch (err) {
      console.error('[numero] foto', p.id, err.message);
      activity('erro', `Número de peito da foto #${p.id}: ${err.message}`);
    }
    await db.tx(async (t) => {
      for (const b of bibs) await t.query('insert into photo_bibs (photo_id, event_id, bib) values ($1, $2, $3) on conflict do nothing', [p.id, p.event_id, b]);
      await t.query('update photos set bib_done = true where id = $1', [p.id]);
    });
    count('bib');
  }
  return rows.length;
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await copyBatch();
    await pollPendingInfinitePay().catch((err) => console.warn('[infinitepay]', err.message));
    await expirePending();
    const rendered = await renderBatch();
    await learnBatch();
    await matchBatch();
    await autoPublish();
    // Previas em dia: numeros de peito e depois fotos novas no Drive (os rostos tem fila propria e nao
    // seguram a importacao).
    if (!rendered) {
      const bibs = await bibBatch();
      if (!bibs) await syncDueSources();
    }
  } catch (err) {
    console.error('[fila]', err);
    activity('erro', `Fila: ${err.message}`);
  } finally {
    busy = false;
  }
}

async function sweep() {
  try {
    const r = await sweepOrphans(db);
    // copias esquecidas do reconhecimento facial e rostos de modelos antigos que nao servem mais (a foto ja tem
    // os rostos do modelo atual ou nao vai ser refeita); os que ainda carregam o borrao de um cliente ficam.
    r.facecache = await cleanFaceCache(db);
    const old = await db.query(
      `delete from faces f where f.model <> $1 and f.blurred_user_id is null
         and not exists (select 1 from photos p where p.id = f.photo_id and p.needs_faces)`,
      [FACE_MODEL],
    );
    r.oldFaces = old.rowCount ?? old.affectedRows ?? 0;
    progress.sweep = { at: new Date().toISOString(), ...r };
    const mb = (r.bytes / 1024 ** 2).toFixed(1).replace('.', ',');
    activity('faxina', r.tmp || r.previews || r.facecache || r.oldFaces
      ? `Faxina: ${r.tmp} arquivo(s) temporário(s), ${r.previews} prévia(s) sem uso, ${r.facecache} cópia(s) do reconhecimento facial e ${r.oldFaces} rosto(s) de modelos antigos apagados (${mb} MB liberados)`
      : 'Faxina: nada sobrando no servidor');
  } catch (err) {
    console.error('[faxina]', err.message);
  }
}

// Reconhecimento facial na fila dele (threads separadas): roda junto com a importacao e as previas.
// O intervalo so serve para pegar fotos novas; a fila em andamento se reabastece sozinha.
function facesTick() {
  facesFill().catch((err) => console.error('[rostos]', err));
}

export function startJobs() {
  // Sincronizacao interrompida por um reinicio (deploy) volta para a fila em vez de ficar presa
  // (se a outra copia do servidor ainda esta trabalhando nela, o sinal de vida esta recente e ela fica).
  db.query(`update drive_sources set last_status = 'na fila'
             where last_status = 'sincronizando' and (sync_heartbeat is null or sync_heartbeat < now() - interval '5 minutes')`).catch(() => {});
  // Antes da fila: troca de modelo do reconhecimento facial (uma vez) e previas que ficaram na pasta de um
  // evento juntado a outro.
  migrateFaceModel()
    .catch((err) => console.error('[rostos] migracao', err.message))
    .then(() => relocateOrphanPreviews(db))
    .then((n) => { if (n) activity('drive', `${n} prévias reaproveitadas (mudaram de pasta, sem baixar de novo)`); })
    .catch((err) => console.error('[previas]', err.message))
    .finally(() => {
      setInterval(tick, 4000).unref();
      setTimeout(tick, 500);
      setInterval(facesTick, 2000).unref();
      cleanFaceCache(db).catch((err) => console.error('[rostos] faxina', err.message));
      // Faxina alguns minutos depois de ligar (a outra copia do deploy ja saiu) e depois uma vez por dia.
      setTimeout(sweep, (Number(process.env.SWEEP_DELAY_S) || 180) * 1000);
      setInterval(sweep, 24 * 60 * 60_000).unref();
    });
}

export async function queueStatus(where = 'true', params = []) {
  return db.one(
    `select count(*) filter (where needs_render)::int as render, count(*) filter (where needs_faces)::int as faces
       from photos p where ${where}`,
    params,
  );
}
