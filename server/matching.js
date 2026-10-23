import { db } from './db.js';
import { FACE_MODEL, DEFAULT_THRESHOLD, STRICT_THRESHOLD, decodeDescriptor, dist2, invalidateFaces } from './faces.js';
import { getSetting, setSetting } from './pricing.js';
import { activity, count } from './activity.js';

// Monitoramento de rostos cadastrados pelos clientes.
//   - Cada rosto novo indexado (faces.id > cursor) e comparado com os rostos cadastrados (user_faces).
//   - Achou: a foto vai para "Minhas fotos -> Encontradas para voce" (user_matches).
//   - Se o cliente ligou "borrar minhas imagens": o rosto e marcado (faces.blurred_user_id), sai da busca por
//     selfie das outras pessoas e a vitrine e refeita borrada.
// Limiar de borrar mais rigido que o de encontrar: so borra quando a semelhanca e bem alta.

const MATCH = DEFAULT_THRESHOLD;
const BLUR = STRICT_THRESHOLD;
const BATCH = 3000;

const vec = decodeDescriptor;
const dist = (a, b) => Math.sqrt(dist2(a, b));

async function loadProfiles(userId = null) {
  const rows = await db.many(
    `select uf.user_id, uf.descriptor, u.blur_me from user_faces uf join users u on u.id = uf.user_id
      where ($1::int is null or uf.user_id = $1) and uf.model = $2`,
    [userId, FACE_MODEL],
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
  let found = 0;
  for (const f of faces) {
    const fv = vec(f.descriptor);
    for (const p of profiles) {
      // Rosto ja borrado por outra pessoa nao e desta pessoa.
      if (f.blurred_user_id && f.blurred_user_id !== p.userId) continue;
      let best = Infinity;
      for (const d of p.descs) best = Math.min(best, dist(fv, d));
      if (best <= MATCH) {
        const r = await db.query(
          `insert into user_matches (user_id, photo_id, distance) values ($1, $2, $3)
           on conflict (user_id, photo_id) do update set distance = least(user_matches.distance, excluded.distance)
           returning (xmax = 0) as fresh`,
          [p.userId, f.photo_id, best],
        );
        if (r.rows[0]?.fresh) found++;
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
  if (found) {
    count('match', found);
    activity('match', `${found} foto(s) nova(s) em "Encontradas para você" de clientes`);
  }
  if (blurred) activity('blur', `${blurred} rosto(s) borrado(s) a pedido de clientes`);
  return rerender.size;
}

// Varredura completa de um cliente (cadastrou/trocou o rosto, ligou/desligou o borrao, apagou o cadastro).
async function scanUser(userId) {
  const blurOn = (await db.one('select blur_me from users where id = $1', [userId]))?.blur_me;
  const undone = await db.many(
    `update faces set blurred_user_id = null where blurred_user_id = $1 ${blurOn ? `and model = '${FACE_MODEL}'` : ''} returning photo_id`,
    [userId],
  );
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
      const faces = await db.many(`select id, photo_id, descriptor, blurred_user_id from faces where id > $1 and model = '${FACE_MODEL}' order by id limit $2`, [cursor, BATCH]);
      if (!faces.length) break;
      await compare(faces, profiles);
      cursor = faces[faces.length - 1].id;
    }
  }
  await db.query('update users set needs_face_scan = false where id = $1', [userId]);
  activity('rosto', `Varredura completa do rosto de um cliente concluída (#${userId})`);
}

export async function matchBatch() {
  const pending = await db.one('select id from users where needs_face_scan order by id limit 1');
  if (pending) {
    await scanUser(pending.id);
    return 1;
  }
  const cursor = Number(await getSetting('match_cursor', 0)) || 0;
  const faces = await db.many(`select id, photo_id, descriptor, blurred_user_id from faces where id > $1 and model = '${FACE_MODEL}' order by id limit $2`, [cursor, BATCH]);
  if (!faces.length) return 0;
  const profiles = await loadProfiles();
  if (profiles.length) await compare(faces, profiles);
  await setSetting('match_cursor', faces[faces.length - 1].id);
  return faces.length;
}

// Caixas dos rostos borrados de uma foto (exceto os da propria pessoa, quando ela mesma baixa a foto).
// Para refazer uma foto: borroes da versao publica e, para cada pessoa borrada, os borroes da versao dela
// (todos menos o proprio rosto).
export async function blurPlanFor(photoId) {
  const rows = await db.many('select box, blurred_user_id from faces where photo_id = $1 and blurred_user_id is not null and box is not null', [photoId]);
  const users = [...new Set(rows.map((r) => r.blurred_user_id))];
  return {
    boxes: rows.map((r) => r.box),
    privateFor: users.map((u) => ({ userId: u, boxes: rows.filter((r) => r.blurred_user_id !== u).map((r) => r.box) })),
  };
}

export async function blurBoxesFor(photoId, exceptUserId = null) {
  const rows = await db.many(
    `select box from faces where photo_id = $1 and blurred_user_id is not null and ($2::int is null or blurred_user_id <> $2)`,
    [photoId, exceptUserId],
  );
  return rows.map((r) => r.box).filter(Boolean);
}
