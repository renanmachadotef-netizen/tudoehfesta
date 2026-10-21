import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Camada fina sobre o Postgres. Producao: `pg` (DATABASE_URL). Desenvolvimento sem banco: PGlite
// (Postgres em WebAssembly, gravado em DATA_DIR/pglite) com a mesma API `query(sql, params)`.

const INT8 = 20;
const NUMERIC = 1700;
const DATE = 1082; // 'date' fica como texto AAAA-MM-DD (sem fuso horario mudando o dia)
let impl;

async function open() {
  if (config.databaseUrl) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(INT8, (v) => Number(v));
    pg.types.setTypeParser(NUMERIC, (v) => Number(v));
    pg.types.setTypeParser(DATE, (v) => v);
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    pool.on('error', (err) => console.error('[db] erro no pool:', err.message));
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (s, p) => client.query(s, p) });
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(config.dataDir, 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const parsers = { [INT8]: (v) => Number(v), [NUMERIC]: (v) => Number(v), [DATE]: (v) => v };
  const lite = await PGlite.create(dir, { parsers });
  console.log('[db] usando PGlite local em', dir);
  return {
    kind: 'pglite',
    query: (sql, params) => lite.query(sql, params),
    exec: (sql) => lite.exec(sql),
    tx: (fn) => lite.transaction((t) => fn({ query: (s, p) => t.query(s, p) })),
  };
}

export async function initDb() {
  impl = await open();
  const dir = path.dirname(fileURLToPath(import.meta.url));
  await impl.exec(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
}

export const db = {
  query: (sql, params) => impl.query(sql, params),
  async one(sql, params) {
    const r = await impl.query(sql, params);
    return r.rows[0] || null;
  },
  async many(sql, params) {
    const r = await impl.query(sql, params);
    return r.rows;
  },
  tx: (fn) => impl.tx(fn),
};

// bytea volta como Buffer no `pg` e como Uint8Array no PGlite.
export function toBuffer(v) {
  if (!v) return null;
  if (Buffer.isBuffer(v)) return v;
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
