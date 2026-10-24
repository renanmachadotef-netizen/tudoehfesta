import { db } from './db.js';
import { FACE_MODEL, DEFAULT_THRESHOLD, STRICT_THRESHOLD, decodeDescriptor, dist2 } from './faces.js';
import { activity } from './activity.js';

// "Rosto que aprende": para quem cadastrou o rosto, as fotos que a pessoa comprou e as que ela marcou como
// "Sou eu" viram referencias extras do rosto (outros angulos, luzes, idades). Elas valem para "Encontradas
// para voce", para "borrar minhas imagens" e para a busca com a propria selfie.
//   - Comprar nao e aparecer (pais compram fotos dos filhos): de cada foto so entra o rosto que confere com a
//     selfie cadastrada (ou, em cadeia, com outra referencia ja aceita), com limiar mais rigido que a busca.
//   - Rosto pequeno na foto nao entra (pouca informacao).
//   - No maximo MAX_LEARNED, escolhidas para serem as mais variadas entre si.

const LEARN = STRICT_THRESHOLD; // mais rigoroso que a busca
const SAME_PERSON = DEFAULT_THRESHOLD;
const MAX_LEARNED = 12;
const MIN_FACE = 0.03; // largura minima do rosto (fracao da largura da foto)

const vec = decodeDescriptor;

export async function learnUser(userId) {
  const selfies = (await db.many(`select descriptor from user_faces where user_id = $1 and source = 'selfie' and model = $2`, [userId, FACE_MODEL])).map((r) => vec(r.descriptor));
  const before = (await db.many(`select photo_id from user_faces where user_id = $1 and source <> 'selfie' order by photo_id`, [userId])).map((r) => r.photo_id);
  let chosen = [];
  if (selfies.length) {
    // Candidatas: compradas (pedido pago) e marcadas "sou eu"; menos as que a pessoa tirou da lista.
    const cands = await db.many(
      `select distinct on (x.photo_id) x.photo_id, x.source from (
         select photo_id, 'marcada' as source, 0 as pri from face_learn where user_id = $1 and not blocked
         union all select oi.photo_id, 'compra', 1 from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid' where o.user_id = $1
       ) x
       where not exists (select 1 from face_learn b where b.user_id = $1 and b.photo_id = x.photo_id and b.blocked)
       order by x.photo_id, x.pri`,
      [userId],
    );
    const sourceOf = new Map(cands.map((c) => [c.photo_id, c.source]));
    const faces = cands.length ? await db.many(
      `select f.photo_id, f.descriptor, f.box from faces f
        where f.photo_id = any($1::int[]) and (f.blurred_user_id is null or f.blurred_user_id = $2) and f.model = $3`,
      [cands.map((c) => c.photo_id), userId, FACE_MODEL],
    ) : [];
    const byPhoto = new Map();
    for (const f of faces) {
      if (f.box && Number(f.box.w) > 0 && Number(f.box.w) < MIN_FACE) continue;
      if (!byPhoto.has(f.photo_id)) byPhoto.set(f.photo_id, []);
      byPhoto.get(f.photo_id).push({ raw: f.descriptor, v: vec(f.descriptor) });
    }
    // Aceita em cadeia: selfie -> foto parecida -> foto um pouco mais diferente...
    const accepted = [...selfies];
    const learned = [];
    const t2 = LEARN * LEARN;
    for (let progress = true; progress && byPhoto.size;) {
      progress = false;
      for (const [photoId, list] of byPhoto) {
        let best = null;
        let bd = Infinity;
        for (const f of list) for (const a of accepted) { const d = dist2(f.v, a); if (d < bd) { bd = d; best = f; } }
        if (bd <= t2) {
          accepted.push(best.v);
          learned.push({ photoId, source: sourceOf.get(photoId), ...best });
          byPhoto.delete(photoId);
          progress = true;
        }
      }
    }
    // As mais variadas: cada nova e a mais distante de tudo que ja foi escolhido (cobre mais situacoes).
    const refs = [...selfies];
    const pool = [...learned];
    while (chosen.length < MAX_LEARNED && pool.length) {
      let bi = 0;
      let bd = -1;
      pool.forEach((c, i) => {
        let m = Infinity;
        for (const r of refs) m = Math.min(m, dist2(c.v, r));
        if (m > bd) { bd = m; bi = i; }
      });
      const [c] = pool.splice(bi, 1);
      chosen.push(c);
      refs.push(c.v);
    }
  }
  const after = chosen.map((c) => c.photoId).sort((a, b) => a - b);
  const changed = after.join() !== before.join();
  await db.tx(async (t) => {
    if (changed) {
      await t.query(`delete from user_faces where user_id = $1 and source <> 'selfie'`, [userId]);
      for (const c of chosen) {
        await t.query('insert into user_faces (user_id, descriptor, source, photo_id, model) values ($1, $2, $3, $4, $5)', [userId, c.raw, c.source, c.photoId, FACE_MODEL]);
      }
      // Referencias mudaram: refaz "Encontradas para voce" e o borrao com elas.
      await t.query('update users set needs_face_scan = true where id = $1', [userId]);
    }
    await t.query('update users set needs_face_learn = false where id = $1', [userId]);
  });
  if (changed) activity('rosto', `Rosto de um cliente aprendeu com as fotos dele: ${chosen.length} referência(s) extra(s) (#${userId})`);
  return chosen.length;
}

export async function learnBatch() {
  const u = await db.one('select id from users where needs_face_learn order by id limit 1');
  if (!u) return 0;
  await learnUser(u.id);
  return 1;
}

// Fotos marcadas como "Sou eu" por quem esta logado: ficam como candidatas (so entram se conferirem com o rosto cadastrado).
export async function rememberMarks(userId, photoIds) {
  if (!photoIds.length) return;
  await db.query(
    `insert into face_learn (user_id, photo_id) select $1, unnest($2::int[]) on conflict (user_id, photo_id) do nothing`,
    [userId, photoIds],
  );
  await db.query(`update users set needs_face_learn = true where id = $1 and exists (select 1 from user_faces where user_id = $1 and model = $2)`, [userId, FACE_MODEL]);
}

// Busca com selfie de quem esta logado: se a selfie for da propria pessoa (confere com o rosto cadastrado),
// devolve as referencias aprendidas para entrarem na busca. Selfie de outra pessoa (amigo) nao mistura nada.
export async function learnedFor(userId, descriptors) {
  const rows = await db.many('select descriptor, source from user_faces where user_id = $1 and model = $2', [userId, FACE_MODEL]);
  const selfies = rows.filter((r) => r.source === 'selfie').map((r) => vec(r.descriptor));
  const learned = rows.filter((r) => r.source !== 'selfie').map((r) => vec(r.descriptor));
  if (!selfies.length || !learned.length) return [];
  const t2 = SAME_PERSON * SAME_PERSON;
  const mine = descriptors.some((d) => selfies.some((s) => dist2(Float32Array.from(d), s) <= t2));
  return mine ? learned : [];
}
