import { db } from './db.js';
import { thumbUrl } from './storage.js';

export async function getSetting(key, fallback = null) {
  const row = await db.one('select value from settings where key = $1', [key]);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.query(
    'insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value',
    [key, JSON.stringify(value)],
  );
}

// Preco do acervo. Foto de evento cadastrado vale o preco do evento (com pacote e descontos) ate N meses depois
// da data do evento; depois disso, e sempre para fotos que estao so no acervo do ano, vale a tabela do acervo:
// um preco por ano (se definido) ou o preco padrao. months = 0 desliga a passagem de eventos para o acervo.
const ARCHIVE_DEFAULT = { months: 12, price_cents: 1500, years: {} };
let archive = ARCHIVE_DEFAULT;

export function normalizeArchive(v) {
  const months = Math.max(0, Math.min(120, Math.round(Number(v?.months ?? ARCHIVE_DEFAULT.months)) || 0));
  const price = Math.max(100, Math.round(Number(v?.price_cents ?? ARCHIVE_DEFAULT.price_cents)) || ARCHIVE_DEFAULT.price_cents);
  const years = {};
  for (const [y, c] of Object.entries(v?.years || {})) {
    const cents = Math.round(Number(c));
    if (/^\d{4}$/.test(y) && cents >= 100) years[y] = cents;
  }
  return { months, price_cents: price, years };
}
export async function refreshArchivePricing() {
  archive = normalizeArchive(await getSetting('archive_pricing', null));
  return archive;
}
export const archivePricing = () => archive;
// Outra copia do servidor (deploy) pode ter salvo a tabela: relê de tempos em tempos.
setInterval(() => refreshArchivePricing().catch(() => {}), 60_000).unref();

const addMonths = (iso, m) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
};

// Preco que vale hoje para as fotos de um evento (ev: kind, event_date, price_cents, pack_price_cents, discount_tiers).
export function effectivePrice(ev, ap = archive) {
  const year = String(ev.event_date).slice(0, 4);
  const archiveCents = ap.years[year] ?? ap.price_cents;
  const pool = ev.kind === 'pool';
  const from = pool || !ap.months ? null : addMonths(ev.event_date, ap.months);
  const archived = pool || (from !== null && new Date().toISOString().slice(0, 10) >= from);
  if (archived) {
    return { price_cents: archiveCents, pack_price_cents: null, discount_tiers: [], archived: true, archive_from: from, archive_price_cents: archiveCents };
  }
  return {
    price_cents: ev.price_cents, pack_price_cents: ev.pack_price_cents ?? null, discount_tiers: ev.discount_tiers || [],
    archived: false, archive_from: from, archive_price_cents: archiveCents,
  };
}

export function couponLabel(c) {
  if (c.kind === 'fixed') return `R$ ${((c.amount_cents || 0) / 100).toFixed(2).replace('.', ',')} de desconto`;
  if (c.kind === 'free') return `${c.free_photos} foto${c.free_photos === 1 ? '' : 's'} grátis`;
  return `${c.pct}% de desconto`;
}

export function tierPctFor(tiers, n) {
  let pct = 0;
  for (const t of Array.isArray(tiers) ? tiers : []) {
    if (n >= Number(t.min) && Number(t.pct) > pct) pct = Number(t.pct);
  }
  return Math.min(pct, 90);
}

// Regras por evento (cada fotografo define as suas):
//   1. preco por foto x quantidade
//   2. desconto progressivo: maior faixa atingida (ex.: 5+ fotos = 20%)
//   3. "pacote": teto por evento (ex.: leve quantas quiser, no maximo R$ 120)
//   4. cupom, se valer para o evento
// O total do evento e repartido entre as fotos para calcular comissao e repasse por item.
export async function priceCart(photoIds, couponCode) {
  const ids = [...new Set((photoIds || []).map(Number).filter(Boolean))].slice(0, 2000);
  if (!ids.length) return { groups: [], items: [], subtotal: 0, discount: 0, total: 0, coupon: null };

  const rows = await db.many(
    `select p.id as photo_id, p.event_id, p.key, e.title, e.slug, e.price_cents, e.pack_price_cents, e.discount_tiers, e.kind, e.event_date,
            e.photographer_id, ph.commission_pct
       from photos p
       join events e on e.id = p.event_id and e.status = 'published'
       left join photographers ph on ph.user_id = e.photographer_id
      where p.id = any($1::int[]) and not p.hidden
      order by p.event_id, p.id`,
    [ids],
  );
  const globalPct = Number(await getSetting('commission_pct', 15));

  let coupon = null;
  if (couponCode) {
    coupon = await db.one(
      `select * from coupons where upper(code) = upper($1) and active and (max_uses is null or uses < max_uses)
         and (starts_at is null or starts_at <= current_date) and (ends_at is null or ends_at >= current_date)`,
      [String(couponCode).trim()],
    );
  }

  const byEvent = new Map();
  for (const r of rows) {
    if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, { meta: r, photos: [] });
    byEvent.get(r.event_id).photos.push(r);
  }

  const groups = [];
  const items = [];
  let couponUsed = false;
  for (const { meta, photos } of byEvent.values()) {
    const n = photos.length;
    const price = effectivePrice(meta);
    const base = n * price.price_cents;
    const tierPct = tierPctFor(price.discount_tiers, n);
    let total = Math.round(base * (1 - tierPct / 100));
    let packApplied = false;
    if (price.pack_price_cents && total > price.pack_price_cents) {
      total = price.pack_price_cents;
      packApplied = true;
    }
    const couponOk = coupon &&
      (!coupon.event_id || coupon.event_id === meta.event_id) &&
      (!coupon.photographer_id || coupon.photographer_id === meta.photographer_id);
    if (couponOk && (coupon.kind || 'pct') === 'pct') {
      total = Math.round(total * (1 - coupon.pct / 100));
      couponUsed = true;
    }
    const pct = meta.commission_pct != null ? Number(meta.commission_pct) : globalPct;
    const each = Math.floor(total / n);
    let rest = total - each * n;
    for (const ph of photos) {
      const photoId = ph.photo_id;
      const itemPrice = each + (rest-- > 0 ? 1 : 0);
      const commission = Math.round((itemPrice * pct) / 100);
      items.push({
        photo_id: photoId,
        event_id: meta.event_id,
        photographer_id: meta.photographer_id,
        price_cents: itemPrice,
        commission_cents: commission,
        photographer_cents: itemPrice - commission,
        _pct: pct,
        _coupon: !!couponOk,
        thumb: thumbUrl(ph.event_id, photoId, ph.key),
      });
    }
    groups.push({
      event_id: meta.event_id,
      title: meta.title,
      slug: meta.slug,
      count: n,
      unit_cents: price.price_cents,
      archived: price.archived,
      base_cents: base,
      tier_pct: tierPct,
      pack_applied: packApplied,
      coupon_applied: !!couponOk,
      total_cents: total,
    });
  }
  // Cupom em R$ (desconto no pedido, repartido entre as fotos que ele cobre) ou de N fotos gratis (as mais baratas).
  if (coupon && ['fixed', 'free'].includes(coupon.kind)) {
    const eligible = items.filter((it) => it._coupon && it.price_cents > 0);
    let off = 0;
    if (coupon.kind === 'free') {
      for (const it of [...eligible].sort((a, b) => a.price_cents - b.price_cents).slice(0, Math.max(0, coupon.free_photos || 0))) {
        off += it.price_cents;
        it.price_cents = 0;
      }
    } else {
      const base = eligible.reduce((s, it) => s + it.price_cents, 0);
      const want = Math.min(Math.max(0, coupon.amount_cents || 0), base);
      let left = want;
      eligible.forEach((it, i) => {
        const cut = i === eligible.length - 1 ? left : Math.min(left, Math.round((it.price_cents * want) / base));
        it.price_cents -= cut;
        left -= cut;
      });
      off = want;
    }
    if (off > 0) {
      couponUsed = true;
      for (const it of eligible) {
        it.commission_cents = Math.round((it.price_cents * it._pct) / 100);
        it.photographer_cents = it.price_cents - it.commission_cents;
      }
      for (const g of groups) {
        g.total_cents = items.filter((it) => it.event_id === g.event_id).reduce((s, it) => s + it.price_cents, 0);
        if (eligible.some((it) => it.event_id === g.event_id)) g.coupon_applied = true;
      }
    }
  }
  for (const it of items) {
    delete it._pct;
    delete it._coupon;
  }
  const subtotal = groups.reduce((s, g) => s + g.base_cents, 0);
  const total = groups.reduce((s, g) => s + g.total_cents, 0);
  return {
    groups,
    items,
    subtotal,
    discount: subtotal - total,
    total,
    coupon: coupon ? { code: coupon.code, kind: coupon.kind || 'pct', pct: coupon.pct, label: couponLabel(coupon), applied: couponUsed } : couponCode ? { code: couponCode, invalid: true } : null,
  };
}
