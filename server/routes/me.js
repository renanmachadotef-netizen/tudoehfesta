import { Router } from 'express';
import { db } from '../db.js';
import { requireUser } from '../auth.js';
import { encodeDescriptor } from '../faces.js';
import { photoOut } from './public.js';
import { fail, rateLimit } from '../util.js';
import { activity } from '../activity.js';
import { privateFile } from '../storage.js';

// Rosto do cliente (monitoramento + "borrar minhas imagens") e fotos encontradas para ele.
// Guardamos so os vetores (128 numeros), com consentimento explicito; a selfie nunca sai do aparelho.
const r = Router();
r.use(['/me', '/my'], requireUser);

// Foto em que o cliente pediu borrao: ele mesmo ve a versao sem o proprio rosto borrado (os outros veem borrado).
export const personalOut = (p, userId) => (p.mine_blurred
  ? { ...photoOut(p), thumb: `/api/my/view/${p.id}/t?k=${p.key}`, preview: `/api/my/view/${p.id}/p?k=${p.key}` }
  : photoOut(p));
export const MINE_BLURRED = (param) => `exists (select 1 from faces bf where bf.photo_id = p.id and bf.blurred_user_id = ${param}) as mine_blurred`;

r.get('/my/view/:id/:size', async (req, res) => {
  const p = await db.one('select id, event_id, key from photos where id = $1', [Number(req.params.id)]);
  if (!p?.key) return res.status(404).end();
  const file = privateFile(p.id, req.user.id, p.key, req.params.size);
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file, { dotfiles: 'allow' }, (err) => {
    // Ainda sendo gerada (ou a pessoa nao esta na foto): mostra a versao publica.
    if (err && !res.headersSent) res.redirect(302, photoOut(p)[req.params.size === 't' ? 'thumb' : 'preview']);
  });
});

r.get('/me/face', async (req, res) => {
  const u = await db.one(
    `select u.face_consent_at, u.blur_me, u.needs_face_scan,
            (select count(*) from user_faces f where f.user_id = u.id)::int as faces,
            (select count(*) from faces f where f.blurred_user_id = u.id)::int as blurred
       from users u where u.id = $1`,
    [req.user.id],
  );
  res.json({ registered: u.faces > 0, faces: u.faces, consent_at: u.face_consent_at, blur_me: u.blur_me, scanning: u.needs_face_scan, blurred: u.blurred });
});

r.post('/me/face', rateLimit('face-register', 10, 60_000), async (req, res) => {
  if (req.body?.consent !== true) fail(400, 'É preciso autorizar o uso do seu rosto para ativar o monitoramento.');
  const descs = (req.body?.descriptors || []).slice(0, 3).map(encodeDescriptor).filter(Boolean);
  if (!descs.length) fail(400, 'Não conseguimos ler o rosto da selfie. Tente outra, de frente e com boa luz.');
  await db.tx(async (t) => {
    await t.query('delete from user_faces where user_id = $1', [req.user.id]);
    for (const d of descs) await t.query('insert into user_faces (user_id, descriptor) values ($1, $2)', [req.user.id, d]);
    await t.query('update users set face_consent_at = now(), needs_face_scan = true where id = $1', [req.user.id]);
  });
  activity('rosto', `Cliente #${req.user.id} cadastrou o rosto para monitoramento`);
  res.json({ ok: true });
});

// Apagar o cadastro do rosto: remove os vetores, desliga o borrao e limpa as sugestoes nao vistas.
r.delete('/me/face', async (req, res) => {
  await db.query('delete from user_faces where user_id = $1', [req.user.id]);
  await db.query('update users set face_consent_at = null, blur_me = false, needs_face_scan = true where id = $1', [req.user.id]);
  res.json({ ok: true });
});

r.put('/me/privacy', async (req, res) => {
  const blur = !!req.body?.blur_me;
  if (blur) {
    const f = await db.one('select count(*)::int as n from user_faces where user_id = $1', [req.user.id]);
    if (!f.n) fail(400, 'Cadastre seu rosto primeiro para o sistema saber quem borrar.');
  }
  await db.query('update users set blur_me = $2, needs_face_scan = true where id = $1', [req.user.id, blur]);
  activity('blur', `Cliente #${req.user.id} ${blur ? 'ligou' : 'desligou'} "borrar minhas imagens"`);
  res.json({ ok: true });
});

// "Encontradas para voce": fotos em que o sistema achou o cliente e que ele ainda nao comprou.
r.get('/my/matches', async (req, res) => {
  const rows = await db.many(
    `select p.id, p.event_id, p.width, p.height, p.key, m.seen, m.created_at, e.title as event_title, e.slug as event_slug,
            e.event_date, e.price_cents, e.kind as event_kind, ${MINE_BLURRED('$1')}
       from user_matches m
       join photos p on p.id = m.photo_id and p.key is not null and not p.hidden
       join events e on e.id = p.event_id and e.status = 'published'
      where m.user_id = $1
        and not exists (select 1 from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
                         where oi.photo_id = p.id and o.user_id = $1)
      order by e.event_date desc, p.sort_key nulls last, p.id
      limit 2000`,
    [req.user.id],
  );
  res.json({
    photos: rows.map((p) => ({
      ...personalOut(p, req.user.id), event_title: p.event_title, event_slug: p.event_slug, event_date: p.event_date,
      price_cents: p.price_cents, event_kind: p.event_kind, new: !p.seen,
    })),
  });
});

r.post('/my/matches/seen', async (req, res) => {
  await db.query('update user_matches set seen = true where user_id = $1 and not seen', [req.user.id]);
  res.json({ ok: true });
});

export default r;
