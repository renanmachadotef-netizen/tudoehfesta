import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, checkPassword, setSession, clearSession, requireUser } from '../auth.js';
import { fail, cleanText, isEmail, rateLimit, uniqueSlug } from '../util.js';
import { activity } from '../activity.js';

const r = Router();

async function createUser({ name, email, password, phone }, role = 'customer') {
  email = String(email || '').trim().toLowerCase();
  if (!cleanText(name, 120)) fail(400, 'Informe seu nome.');
  if (!isEmail(email)) fail(400, 'E-mail inválido.');
  if (String(password || '').length < 6) fail(400, 'A senha precisa ter pelo menos 6 caracteres.');
  const exists = await db.one('select id from users where email = $1', [email]);
  if (exists) fail(409, 'Já existe uma conta com este e-mail. Entre com sua senha.');
  return db.one(
    `insert into users (email, name, phone, password_hash, role) values ($1, $2, $3, $4, $5) returning id`,
    [email, cleanText(name, 120), cleanText(phone, 30), await hashPassword(password), role],
  );
}

r.post('/register', rateLimit('register', 10, 60_000), async (req, res) => {
  const u = await createUser(req.body);
  activity('cliente', `Novo cadastro de cliente (#${u.id})`);
  setSession(res, u.id);
  res.json({ ok: true });
});

r.post('/login', rateLimit('login', 12, 60_000), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const u = await db.one('select id, password_hash from users where email = $1', [email]);
  if (!u || !(await checkPassword(String(req.body?.password || ''), u.password_hash))) {
    fail(401, 'E-mail ou senha incorretos.');
  }
  setSession(res, u.id);
  res.json({ ok: true });
});

r.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

r.get('/me', (req, res) => res.json({ user: req.user }));

r.put('/me', requireUser, async (req, res) => {
  const { name, phone, password, current_password: current } = req.body || {};
  if (password) {
    const u = await db.one('select password_hash from users where id = $1', [req.user.id]);
    if (!(await checkPassword(String(current || ''), u.password_hash))) fail(400, 'Senha atual incorreta.');
    if (String(password).length < 6) fail(400, 'A nova senha precisa ter pelo menos 6 caracteres.');
    await db.query('update users set password_hash = $2 where id = $1', [req.user.id, await hashPassword(password)]);
  }
  await db.query('update users set name = coalesce($2, name), phone = $3 where id = $1', [
    req.user.id,
    cleanText(name, 120),
    cleanText(phone, 30),
  ]);
  res.json({ ok: true });
});

// "Seja fotografo": cria (ou promove) a conta e deixa o cadastro em analise para o admin aprovar.
r.post('/photographer', rateLimit('register', 10, 60_000), async (req, res) => {
  const b = req.body || {};
  let userId = req.user?.id;
  if (!userId) {
    userId = (await createUser(b, 'photographer')).id;
    setSession(res, userId);
  } else if (req.user.role === 'customer') {
    await db.query(`update users set role = 'photographer' where id = $1`, [userId]);
  }
  const already = await db.one('select user_id from photographers where user_id = $1', [userId]);
  if (already) fail(409, 'Você já tem cadastro de fotógrafo.');
  const display = cleanText(b.display_name, 80) || cleanText(b.name, 80) || req.user?.name;
  if (!display) fail(400, 'Informe o nome artístico ou do estúdio.');
  await db.query(
    `insert into photographers (user_id, slug, display_name, city, instagram, whatsapp, camera, bio)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      await uniqueSlug('photographers', display, null, 'user_id'),
      display,
      cleanText(b.city, 80),
      cleanText(String(b.instagram || '').replace(/^@/, ''), 60),
      cleanText(b.whatsapp, 30),
      cleanText(b.camera, 80),
      cleanText(b.bio, 600),
    ],
  );
  res.json({ ok: true, status: 'pending' });
});

export default r;
