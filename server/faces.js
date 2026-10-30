import { db, toBuffer } from './db.js';
import { getSetting, setSetting } from './pricing.js';
import { activity } from './activity.js';

// Busca facial por forca bruta em memoria. Cada rosto = DIM numeros normalizados (512 no buffalo_l, 128 no
// SFace), guardados com 1 byte cada (valor x SCALE + 128). 1 milhao de rostos buffalo_l = ~512 MB.
import { FACE_MODEL, DIM } from './face-model.js';
export { FACE_MODEL, DIM };

// Distancia euclidiana entre codigos normalizados (0 a 2). Alem do limite fixo, a busca usa um limite ajustado
// a cada selfie (ver searchFaces), para grupos de rostos muito parecidos entre si (criancas).
//   buffalo_l, medido com rostos de 30 a 75 px: a mesma pessoa fica ate ~0,7; pessoas diferentes a partir de ~1,28.
//   SFace: a mesma pessoa ate ~0,75; pessoas diferentes a partir de ~1,18.
const TUNING = {
  buffalo_l: { scale: 500, threshold: 1.1, strict: 1, margin: 0.15, range: [0.85, 1.2] },
  sface: { scale: 250, threshold: 1, strict: 0.9, margin: 0.22, range: [0.7, 1.1] },
}[FACE_MODEL];
const SCALE = TUNING.scale;
export const DEFAULT_THRESHOLD = TUNING.threshold; // busca e "Encontradas para voce"
export const STRICT_THRESHOLD = TUNING.strict; // borrar e aprender referencias (mais rigoroso)
export const CROWD_RANK = 1000; // o "aglomerado" de rostos parecidos com a selfie: o milesimo rosto mais perto
export const CROWD_MARGIN = TUNING.margin; // so vale o que estiver pelo menos isso mais perto que o aglomerado
export const THRESHOLD_RANGE = TUNING.range;
export const MAX_FACES = 80;

let version = 0;
const cache = new Map(); // escopo -> { version, photoIds, eventIds, data }

export function invalidateFaces() {
  version++;
}

// Troca de modelo (roda uma vez): todas as fotos tem os rostos refeitos aos poucos pela fila (os originais vem
// do Drive quando preciso) e quem tinha cadastrado o rosto precisa de uma selfie nova (o codigo antigo nao
// serve no modelo novo e a selfie nunca e guardada). O borrao de quem pediu continua (passa para o rosto novo).
export async function migrateFaceModel() {
  if ((await getSetting('face_model', null)) === FACE_MODEL) return;
  const photos = await db.query(`update photos set needs_faces = true, faces_redo = true where key is not null and original_path <> '' and not needs_faces`);
  const users = await db.query('update users set face_update_needed = true where id in (select user_id from user_faces where model <> $1)', [FACE_MODEL]);
  await db.query('delete from user_faces where model <> $1', [FACE_MODEL]);
  await setSetting('face_model', FACE_MODEL);
  activity('rosto', `Novo reconhecimento facial: ${photos.rowCount ?? photos.affectedRows ?? 0} fotos na fila para refazer os rostos; ${users.rowCount ?? users.affectedRows ?? 0} cliente(s) vão cadastrar a selfie de novo`);
}

export function encodeDescriptor(arr) {
  if (!arr || arr.length !== DIM) return null;
  const q = new Uint8Array(DIM);
  for (let i = 0; i < DIM; i++) {
    const v = Number(arr[i]);
    if (!Number.isFinite(v)) return null;
    q[i] = Math.max(0, Math.min(255, Math.round(v * SCALE) + 128));
  }
  return Buffer.from(q.buffer);
}

export function decodeDescriptor(bytes) {
  const b = toBuffer(bytes);
  const f = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) f[i] = (b[i] - 128) / SCALE;
  return f;
}

export function dist2(a, b) {
  let s = 0;
  for (let k = 0; k < DIM; k++) { const d = a[k] - b[k]; s += d * d; }
  return s;
}

// Grava os rostos de uma foto (troca os anteriores). Se o cliente tinha pedido para borrar o rosto dele
// nesta foto, o borrao continua no rosto novo da mesma posicao (reprocessamento / troca de modelo).
const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export async function saveFaces(q, photo, faces) {
  const old = (await q.query('select box, blurred_user_id from faces where photo_id = $1 and blurred_user_id is not null', [photo.id])).rows || [];
  await q.query('delete from faces where photo_id = $1', [photo.id]);
  let saved = 0;
  for (const f of faces.slice(0, MAX_FACES)) {
    const buf = encodeDescriptor(f.d);
    if (!buf) continue;
    const blur = f.box && old.find((o) => o.box && (inside(center(f.box), o.box) || inside(center(o.box), f.box)));
    await q.query(
      'insert into faces (photo_id, event_id, year, descriptor, box, model, blurred_user_id) values ($1, $2, $3, $4, $5::jsonb, $6, $7)',
      [photo.id, photo.event_id, photo.year, buf, JSON.stringify(f.box || null), FACE_MODEL, blur?.blurred_user_id || null],
    );
    saved++;
  }
  return saved;
}

async function loadScope(scope) {
  const hit = cache.get(scope);
  if (hit && hit.version === version) return hit;
  // Rostos borrados a pedido do proprio cliente nunca aparecem na busca de outras pessoas.
  // Fotos ocultas pelo fotografo tambem ficam de fora. So rostos do modelo atual.
  const visible = `f.model = '${FACE_MODEL}' and f.blurred_user_id is null and not exists (select 1 from photos hp where hp.id = f.photo_id and hp.hidden)`;
  // Eventos com senha ficam fora da busca geral e por ano (so dentro do proprio evento, depois da senha).
  let where = `${visible} and f.event_id in (select id from events where status = 'published' and visibility <> 'password')`;
  const params = [];
  if (scope.startsWith('year:')) {
    params.push(Number(scope.slice(5)));
    where += ` and f.year = $${params.length}`;
  } else if (scope.startsWith('event:')) {
    params.push(Number(scope.slice(6)));
    where = `${visible} and f.event_id = $${params.length}`;
  }
  const rows = await db.many(`select f.photo_id, f.event_id, f.descriptor from faces f where ${where}`, params);
  const data = new Uint8Array(rows.length * DIM);
  const photoIds = new Int32Array(rows.length);
  const eventIds = new Int32Array(rows.length);
  rows.forEach((r, i) => {
    data.set(toBuffer(r.descriptor).subarray(0, DIM), i * DIM);
    photoIds[i] = r.photo_id;
    eventIds[i] = r.event_id;
  });
  const entry = { version, photoIds, eventIds, data };
  cache.set(scope, entry);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return entry;
}

// "Sou eu nesta foto": o rosto da pessoa nas fotos que ela marcou vira referencia extra da busca
// (ajuda a achar fotos de outras epocas, quando o rosto mudou). De cada foto marcada so entra o rosto
// que bate com a selfie ou com outra referencia ja aceita: ninguem consegue usar isso para buscar outra pessoa.
export async function seedDescriptors(photoIds, queries, threshold = DEFAULT_THRESHOLD) {
  if (!photoIds.length) return [];
  const rows = await db.many(
    `select f.photo_id, f.descriptor from faces f
       join photos p on p.id = f.photo_id and not p.hidden
       join events e on e.id = f.event_id and e.status = 'published' and e.visibility <> 'password'
      where f.photo_id = any($1::int[]) and f.blurred_user_id is null and f.model = $2`,
    [photoIds, FACE_MODEL],
  );
  const byPhoto = new Map();
  for (const r of rows) {
    if (!byPhoto.has(r.photo_id)) byPhoto.set(r.photo_id, []);
    byPhoto.get(r.photo_id).push(decodeDescriptor(r.descriptor));
  }
  const accepted = queries.map((q) => Float32Array.from(q));
  const added = [];
  const t2 = threshold * threshold;
  // Encadeia: uma foto aceita pode validar outra (selfie de hoje -> foto de 2015 -> foto de 2008).
  for (let progress = true; progress && byPhoto.size;) {
    progress = false;
    for (const [photoId, faces] of byPhoto) {
      let best = null;
      let bd = Infinity;
      for (const f of faces) for (const q of accepted) { const d = dist2(f, q); if (d < bd) { bd = d; best = f; } }
      if (bd <= t2) {
        accepted.push(best);
        added.push({ photoId, descriptor: best });
        byPhoto.delete(photoId);
        progress = true;
      }
    }
  }
  return added;
}

// Limite ajustado a selfie: mede a que distancia fica o aglomerado de rostos parecidos com ela (o milesimo
// rosto mais perto do escopo, ou a mediana em escopos pequenos) e aceita so o que estiver bem mais perto.
// A pessoa de verdade fica destacada do aglomerado; rostos so "parecidos" (criancas, por exemplo) nao.
function crowdLimit(q, data, n) {
  if (n < 40) return Infinity;
  const rank = Math.min(CROWD_RANK, Math.floor(n / 2));
  const ds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * DIM;
    let sum = 0;
    for (let k = 0; k < DIM; k++) { const d = data[off + k] - q[k]; sum += d * d; }
    ds[i] = sum;
  }
  ds.sort();
  return Math.sqrt(ds[rank - 1]) / SCALE - CROWD_MARGIN;
}

// descriptors: lista de vetores (selfie, fotos marcadas, referencias aprendidas). Devolve fotos pela menor distancia
// e o limite usado.
export async function searchFaces(descriptors, scope, threshold = DEFAULT_THRESHOLD, limit = 1000) {
  // As contas sao feitas na escala de 1 byte (inteiros): rapido e sem converter o acervo.
  const queries = descriptors.map((d) => Float32Array.from(d, (v) => Math.max(0, Math.min(255, v * SCALE + 128))));
  const { photoIds, eventIds, data } = await loadScope(scope);
  const best = new Map();
  // o aglomerado e medido pela selfie (primeiro vetor); vale para todas as referencias da busca
  const used = Math.min(threshold, queries.length ? crowdLimit(queries[0], data, photoIds.length) : Infinity);
  const t2 = (used * SCALE) ** 2;
  for (let i = 0, n = photoIds.length; i < n; i++) {
    const off = i * DIM;
    for (const q of queries) {
      let sum = 0;
      for (let k = 0; k < DIM; k++) {
        const d = data[off + k] - q[k];
        sum += d * d;
        if (sum > t2) break;
      }
      if (sum <= t2) {
        const dist = Math.sqrt(sum) / SCALE;
        const prev = best.get(photoIds[i]);
        if (!prev || dist < prev.distance) best.set(photoIds[i], { photoId: photoIds[i], eventId: eventIds[i], distance: dist });
      }
    }
  }
  const hits = [...best.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
  hits.limit = used;
  return hits;
}
