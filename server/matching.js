import { db, toBuffer } from './db.js';
import { DIM, invalidateFaces } from './faces.js';
import { getSetting, setSetting } from './pricing.js';

// Monitoramento de rostos cadastrados pelos clientes.
//   - Cada rosto novo indexado (faces.id > cursor) e comparado com os rostos cadastrados (user_faces).
//   - Achou: a foto vai para "Minhas fotos -> Encontradas para voce" (user_matches).
//   - Se o cliente ligou "borrar minhas imagens": o rosto e marcado (faces.blurred_user_id), sai da busca por
//     selfie das outras pessoas e a vitrine e refeita borrada.
// Limiar de borrar mais rigido que o de encontrar: so borra quando a semelhanca e bem alta.

const MATCH = 0.5;
const BLUR = 0.47;
const BATCH = 3000;

const vec = (b) => {
  const buf = toBuffer(b);
  return new Float32Array(buf.buffer, buf.byteOffset, DIM);
};
function dist(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

async function loadProfiles(userId = null) {
  const rows = await db.many(
    `select uf.user_id, uf.descriptor, u.blur_me from user_faces uf join users u on u.id = uf.user_id
      where ($1::int is null or uf.user_id = $1)`,
    [userId],
  );
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { userId: r.user_id, blur: r.blur_me, descs: [] });
    byUser.get(r.user_id).descs.push(vec(r.descriptor));
  }
  return [...byUser.values()];
}

// Compara um lote de rostos com os perfis; devolve quantas fotos precisam ser refeitas (borrao).
async function compare(faces, profiles) {
  const rerender = new Set();
  let blurred = 0;
  for (const f of faces) {
    const fv = vec(f.descriptor);
    for (const p of profiles) {
      // Rosto ja borrado por outra pessoa nao e desta pessoa.
      if (f.blurred_user_id && f.blurred_user_id !== p.userId) continue;
      let best = Infinity;
      for (const d of p.descs) best = Math.min(best, dist(fv, d));
      if (best <= MATCH) {
        await db.query(
          `insert into user_matches (user_id, photo_id, distance) values ($1, $2, $3)
           on conflict (user_id, photo_id) do update set distance = least(user_matches.distance, excluded.distance)`,
          [p.userId, f.photo_id, best],
        );
      }
      if (p.blur && best <= BLUR && !f.blurred_user_id) {
        await db.query('update faces set blurred_user_id = $2 where id = $1 and blurred_user_id is null', [f.id, p.userId]);
        rerender.add(f.photo_id);
        blurred++;
      }
    }
  }
  if (rerender.size) await db.query('update photos set needs_render = true where id = any($1::int[])', [[...rerender]]);
  if (blurred) invalidateFaces();
  return rerender.size;
}

// Varredura completa de um cliente (cadastrou/trocou o rosto, ligou/desligou o borrao, apagou o cadastro).
async function scanUser(userId) {
  const undone = await db.many('update faces set blurred_user_id = null where blurred_user_id = $1 returning photo_id', [userId]);
  if (undone.length) {
    await db.query('update photos set needs_render = true where id = any($1::int[])', [[...new Set(undone.map((r) => r.photo_id))]]);
    invalidateFaces();
  }
  // Recomeca as sugestoes nao vistas (o rosto pode ter mudado); as ja vistas ficam.
  await db.query('delete from user_matches where user_id = $1 and not seen', [userId]);
  const profiles = await loadProfiles(userId);
  if (profiles.length) {
    let cursor = 0;
    for (;;) {
      const faces = await db.many('select id, photo_id, descriptor, blurred_user_id from faces where id > $1 order by id limit $2', [cursor, BATCH]);
      if (!faces.length) break;
      await compare(faces, profiles);
      cursor = faces[faces.length - 1].id;
    }
  }
  await db.query('update users set needs_face_scan = false where id = $1', [userId]);
}

export async function matchBatch() {
  const pending = await db.one('select id from users where needs_face_scan order by id limit 1');
  if (pending) {
    await scanUser(pending.id);
    return 1;
  }
  const cursor = Number(await getSetting('match_cursor', 0)) || 0;
  const faces = await db.many('select id, photo_id, descriptor, blurred_user_id from faces where id > $1 order by id limit $2', [cursor, BATCH]);
  if (!faces.length) return 0;
  const profiles = await loadProfiles();
  if (profiles.length) await compare(faces, profiles);
  await setSetting('match_cursor', faces[faces.length - 1].id);
  return faces.length;
}

// Caixas dos rostos borrados de uma foto (exceto os da propria pessoa, quando ela mesma baixa a foto).
export async function blurBoxesFor(photoId, exceptUserId = null) {
  const rows = await db.many(
    `select box from faces where photo_id = $1 and blurred_user_id is not null and ($2::int is null or blurred_user_id <> $2)`,
    [photoId, exceptUserId],
  );
  return rows.map((r) => r.box).filter(Boolean);
}
