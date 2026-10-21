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
    `select p.id as photo_id, p.event_id, p.key, e.title, e.slug, e.price_cents, e.pack_price_cents, e.discount_tiers,
            e.photographer_id, ph.commission_pct
       from photos p
       join events e on e.id = p.event_id and e.status = 'published'
       left join photographers ph on ph.user_id = e.photographer_id
      where p.id = any($1::int[])
      order by p.event_id, p.id`,
    [ids],
  );
  const globalPct = Number(await getSetting('commission_pct', 15));

  let coupon = null;
  if (couponCode) {
    coupon = await db.one(
      `select * from coupons where upper(code) = upper($1) and active and (max_uses is null or uses < max_uses)`,
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
    const base = n * meta.price_cents;
    const tierPct = tierPctFor(meta.discount_tiers, n);
    let total = Math.round(base * (1 - tierPct / 100));
    let packApplied = false;
    if (meta.pack_price_cents && total > meta.pack_price_cents) {
      total = meta.pack_price_cents;
      packApplied = true;
    }
    const couponOk = coupon &&
      (!coupon.event_id || coupon.event_id === meta.event_id) &&
      (!coupon.photographer_id || coupon.photographer_id === meta.photographer_id);
    if (couponOk) {
      total = Math.round(total * (1 - coupon.pct / 100));
      couponUsed = true;
    }
    const pct = meta.commission_pct != null ? Number(meta.commission_pct) : globalPct;
    const each = Math.floor(total / n);
    let rest = total - each * n;
    for (const ph of photos) {
      const photoId = ph.photo_id;
      const price = each + (rest-- > 0 ? 1 : 0);
      const commission = Math.round((price * pct) / 100);
      items.push({
        photo_id: photoId,
        event_id: meta.event_id,
        photographer_id: meta.photographer_id,
        price_cents: price,
        commission_cents: commission,
        photographer_cents: price - commission,
        thumb: thumbUrl(ph.event_id, photoId, ph.key),
      });
    }
    groups.push({
      event_id: meta.event_id,
      title: meta.title,
      slug: meta.slug,
      count: n,
      unit_cents: meta.price_cents,
      base_cents: base,
      tier_pct: tierPct,
      pack_applied: packApplied,
      coupon_applied: !!couponOk,
      total_cents: total,
    });
  }
  const subtotal = groups.reduce((s, g) => s + g.base_cents, 0);
  const total = groups.reduce((s, g) => s + g.total_cents, 0);
  return {
    groups,
    items,
    subtotal,
    discount: subtotal - total,
    total,
    coupon: coupon ? { code: coupon.code, pct: coupon.pct, applied: couponUsed } : couponCode ? { code: couponCode, invalid: true } : null,
  };
}
