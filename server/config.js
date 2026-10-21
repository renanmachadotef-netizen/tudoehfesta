import path from 'node:path';
import crypto from 'node:crypto';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && !env.DATABASE_URL) {
  console.error('[config] DATABASE_URL nao definido. No Easypanel: servico db > Credentials > Internal connection URL, cole em site > Environment.');
  process.exit(1);
}
if (isProd && !env.SESSION_SECRET) {
  console.warn('[config] SESSION_SECRET nao definido: sessoes vao cair a cada reinicio. Defina no Easypanel.');
}

export const config = {
  isProd,
  port: Number(env.PORT || 3001),
  // Sem DATABASE_URL o servidor usa um Postgres embutido (PGlite) em DATA_DIR/pglite: so para desenvolvimento.
  databaseUrl: env.DATABASE_URL || '',
  dataDir: path.resolve(env.DATA_DIR || './data'),
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  publicUrl: (env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
  adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || '',
  mpAccessToken: env.MP_ACCESS_TOKEN || '',
  watermarkText: env.WATERMARK_TEXT || 'tudoehfesta.com',
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 40),
};
