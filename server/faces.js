import { db, toBuffer } from './db.js';

// Busca facial por forca bruta em memoria. Cada rosto = 128 floats (modelo FaceNet/face-api).
// 100 mil rostos = ~51 MB e ~20 ms por busca: sobra para a escala regional. Se um dia passar de
// alguns milhoes, trocar por pgvector (indice HNSW) sem mudar a API.

export const DIM = 128;
export const DEFAULT_THRESHOLD = 0.5; // distancia euclidiana; < 0.5 costuma ser a mesma pessoa

let version = 0;
const cache = new Map(); // escopo -> { version, photoIds, eventIds, data }

export function invalidateFaces() {
  version++;
}

export function encodeDescriptor(arr) {
  if (!Array.isArray(arr) || arr.length !== DIM) return null;
  const f = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    const v = Number(arr[i]);
    if (!Number.isFinite(v)) return null;
    f[i] = v;
  }
  return Buffer.from(f.buffer);
}

async function loadScope(scope) {
  const hit = cache.get(scope);
  if (hit && hit.version === version) return hit;
  // Rostos borrados a pedido do proprio cliente nunca aparecem na busca de outras pessoas.
  // Fotos ocultas pelo fotografo tambem ficam de fora.
  const visible = 'f.blurred_user_id is null and not exists (select 1 from photos hp where hp.id = f.photo_id and hp.hidden)';
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
  const data = new Float32Array(rows.length * DIM);
  const photoIds = new Int32Array(rows.length);
  const eventIds = new Int32Array(rows.length);
  rows.forEach((r, i) => {
    const b = toBuffer(r.descriptor);
    data.set(new Float32Array(b.buffer, b.byteOffset, DIM), i * DIM);
    photoIds[i] = r.photo_id;
    eventIds[i] = r.event_id;
  });
  const entry = { version, photoIds, eventIds, data };
  cache.set(scope, entry);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return entry;
}

// descriptors: lista de vetores (1 a 3 selfies). Devolve fotos ordenadas pela menor distancia.
// "Sou eu nesta foto": o rosto da pessoa nas fotos que ela marcou vira referencia extra da busca
// (ajuda a achar fotos de outras epocas, quando o rosto mudou). De cada foto marcada so entra o rosto
// que bate com a selfie ou com outra referencia ja aceita: ninguem consegue usar isso para buscar outra pessoa.
export async function seedDescriptors(photoIds, queries, threshold = DEFAULT_THRESHOLD) {
  if (!photoIds.length) return [];
  const rows = await db.many(
    `select f.photo_id, f.descriptor from faces f
       join photos p on p.id = f.photo_id and not p.hidden
       join events e on e.id = f.event_id and e.status = 'published' and e.visibility <> 'password'
      where f.photo_id = any($1::int[]) and f.blurred_user_id is null`,
    [photoIds],
  );
  const byPhoto = new Map();
  for (const r of rows) {
    const b = toBuffer(r.descriptor);
    const d = Float32Array.from(new Float32Array(b.buffer, b.byteOffset, DIM));
    if (!byPhoto.has(r.photo_id)) byPhoto.set(r.photo_id, []);
    byPhoto.get(r.photo_id).push(d);
  }
  const accepted = queries.map((q) => Float32Array.from(q));
  const added = [];
  const t2 = threshold * threshold;
  const dist2 = (a, b) => {
    let s = 0;
    for (let k = 0; k < DIM; k++) { const d = a[k] - b[k]; s += d * d; }
    return s;
  };
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

export async function searchFaces(descriptors, scope, threshold = DEFAULT_THRESHOLD, limit = 1000) {
  const queries = descriptors.map((d) => new Float32Array(d));
  const { photoIds, eventIds, data } = await loadScope(scope);
  const best = new Map();
  const t2 = threshold * threshold;
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
        const dist = Math.sqrt(sum);
        const prev = best.get(photoIds[i]);
        if (!prev || dist < prev.distance) best.set(photoIds[i], { photoId: photoIds[i], eventId: eventIds[i], distance: dist });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
}
