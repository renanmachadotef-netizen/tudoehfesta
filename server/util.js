import crypto from 'node:crypto';
import { db } from './db.js';
import { getSetting } from './pricing.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message);
};

export function slugify(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'evento';
}

export async function uniqueSlug(table, base, exceptId = null, idCol = 'id') {
  let slug = slugify(base);
  for (let i = 2; ; i++) {
    const row = await db.one(`select ${idCol} from ${table} where slug = $1 and ($2::int is null or ${idCol} <> $2)`, [slug, exceptId]);
    if (!row) return slug;
    slug = `${slugify(base).slice(0, 64)}-${i}`;
  }
}

export const orderCode = () => crypto.randomBytes(5).toString('hex').toUpperCase();

export const cleanText = (v, max = 500) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
export const toCents = (v) => {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(String(v).replace(',', '.')) * 100);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

// Saldo do fotografo: vendas pagas ha mais de N dias (prazo para estorno) menos saques pedidos/pagos.
export async function photographerBalance(userId) {
  const releaseDays = Number(await getSetting('release_days', 3));
  const r = await db.one(
    `select
       coalesce(sum(oi.photographer_cents) filter (where o.paid_at <= now() - make_interval(days => $2)), 0)::int8 as released,
       coalesce(sum(oi.photographer_cents) filter (where o.paid_at >  now() - make_interval(days => $2)), 0)::int8 as pending,
       coalesce(sum(oi.photographer_cents), 0)::int8 as lifetime
     from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
     where oi.photographer_id = $1`,
    [userId, releaseDays],
  );
  const p = await db.one(
    `select coalesce(sum(amount_cents) filter (where status = 'paid'), 0)::int8 as paid,
            coalesce(sum(amount_cents) filter (where status = 'requested'), 0)::int8 as requested
       from payouts where photographer_id = $1`,
    [userId],
  );
  return {
    available: Math.max(0, r.released - p.paid - p.requested),
    pending: r.pending,
    lifetime: r.lifetime,
    paid_out: p.paid,
    requested: p.requested,
    release_days: releaseDays,
  };
}

// Limite simples por IP (memoria): protege login e busca facial de abuso.
const buckets = new Map();
export function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(key, b);
    }
    if (++b.count > max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco e tente de novo.' });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    next();
  };
}
