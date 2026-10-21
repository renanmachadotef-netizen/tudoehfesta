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
  let where = 'f.blurred_user_id is null and f.event_id in (select id from events where status = \'published\')';
  const params = [];
  if (scope.startsWith('year:')) {
    params.push(Number(scope.slice(5)));
    where += ` and f.year = $${params.length}`;
  } else if (scope.startsWith('event:')) {
    params.push(Number(scope.slice(6)));
    where = `f.blurred_user_id is null and f.event_id = $${params.length}`;
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
