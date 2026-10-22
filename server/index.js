import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { db, initDb } from './db.js';
import { loadUser, hashPassword } from './auth.js';
import { dirs } from './storage.js';
import { HttpError, uniqueSlug } from './util.js';
import { startJobs } from './jobs.js';
import { refreshArchivePricing } from './pricing.js';
import { progress } from './activity.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import meRoutes from './routes/me.js';
import studioRoutes from './routes/studio.js';
import adminRoutes from './routes/admin.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(root, '..', 'dist');

await initDb();
await refreshArchivePricing();
await seedAdmin();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

app.get('/_health', (_req, res) => res.json({ ok: true }));

// Dominios secundarios (REDIRECT_HOSTS, separados por virgula) levam ao endereco principal (PUBLIC_URL).
// So GET/HEAD: webhooks (POST) continuam funcionando em qualquer dominio.
const redirectHosts = new Set(String(process.env.REDIRECT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
if (redirectHosts.size) {
  app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && redirectHosts.has(String(req.hostname).toLowerCase())) {
      return res.redirect(301, config.publicUrl + req.originalUrl);
    }
    next();
  });
}

// Vitrines e miniaturas (com marca d'agua): cache longo, o nome do arquivo nunca muda de conteudo.
app.use('/m', express.static(dirs.public, { maxAge: '30d', immutable: true, fallthrough: false }));

app.use('/api', loadUser);
app.use('/api', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', orderRoutes);
app.use('/api', meRoutes);
app.use('/api/studio', studioRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// Site (React). index.html sem cache; assets com hash no nome, cache de 1 ano.
if (fs.existsSync(webDist)) {
  app.use('/assets', express.static(path.join(webDist, 'assets'), { maxAge: '1y', immutable: true }));
  app.use('/models', express.static(path.join(webDist, 'models'), { maxAge: '30d' }));
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  const indexHtml = path.join(webDist, 'index.html');
  app.get('/{*path}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

app.use((err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Arquivo maior que ${config.maxUploadMb} MB.` });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Requisição grande demais.' });
  if (err?.status === 404 && req.path.startsWith('/m/')) return res.status(404).end();
  console.error('[erro]', req.method, req.path, err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

app.listen(config.port, () => console.log(`[tudoehfesta] ouvindo na porta ${config.port}`));
startJobs();

// Primeiro admin vem das variaveis ADMIN_EMAIL/ADMIN_PASSWORD (so cria se ainda nao existir).
async function seedAdmin() {
  if (!config.adminEmail || !config.adminPassword) {
    const any = await db.one(`select id from users where role = 'admin' limit 1`);
    if (!any) console.warn('[seed] nenhum admin: defina ADMIN_EMAIL e ADMIN_PASSWORD para criar o primeiro.');
    return;
  }
  let user = await db.one('select id, role from users where email = $1', [config.adminEmail]);
  if (!user) {
    user = await db.one(
      `insert into users (email, name, password_hash, role) values ($1, 'Tudo Eh Festa', $2, 'admin') returning id, role`,
      [config.adminEmail, await hashPassword(config.adminPassword)],
    );
    console.log('[seed] admin criado:', config.adminEmail);
  } else if (user.role !== 'admin') {
    await db.query(`update users set role = 'admin' where id = $1`, [user.id]);
  }
  const ph = await db.one('select user_id from photographers where user_id = $1', [user.id]);
  if (!ph) {
    await db.query(
      `insert into photographers (user_id, slug, display_name, city, instagram, status) values ($1, $2, 'Tudo Eh Festa', 'Araranguá, SC', 'tudoehfesta', 'approved')`,
      [user.id, await uniqueSlug('photographers', 'tudo-eh-festa', null, 'user_id')],
    );
  }
}

// Desligando (deploy): solta a pasta do Drive que esta sendo importada para a nova copia assumir na hora,
// em vez de esperar o sinal de vida expirar.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    const running = progress.sync?.source_id;
    if (running) {
      await db.query(`update drive_sources set last_status = 'na fila', sync_heartbeat = null where id = $1 and last_status = 'sincronizando'`, [running])
        .catch(() => {});
    }
    process.exit(0);
  });
}
