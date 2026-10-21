import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { getSetting } from './pricing.js';

// Mercado Pago (aplicacao "Tudo Eh Festa Site", Checkout Transparente via API de Orders):
//   Pix: POST /v1/orders -> QR Code (imagem + copia e cola) mostrado na propria pagina do pedido.
//        Pago quando GET /v1/orders/{id} devolve status "processed" / "accredited".
//   Cartao (so se a InfinitePay estiver desligada): Checkout Pro, redireciona ao Mercado Pago.
// Sem MP_ACCESS_TOKEN o Pix cai na InfinitePay ou, sem nenhuma das duas, em "Pix manual".

const MP = 'https://api.mercadopago.com';
const TIMEOUT_MS = 10_000;
export const mpEnabled = () => !!config.mpAccessToken;

// HTTPS com certificado verificado (padrao do fetch), tempo limite e 1 nova tentativa em falha de rede/5xx.
// A chave de idempotencia e a mesma nas tentativas: o Mercado Pago nao cria cobranca duplicada.
async function mp(pathname, { method = 'GET', body, idempotency } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(MP + pathname, {
        method,
        headers: {
          Authorization: `Bearer ${config.mpAccessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(idempotency ? { 'X-Idempotency-Key': idempotency } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt < 1) continue;
      throw new Error(`Mercado Pago indisponivel (${err.name === 'TimeoutError' ? 'sem resposta' : err.cause?.code || err.message})`);
    }
    if (res.status >= 500 && attempt < 1) continue;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Guarda o detalhe completo (codigos e motivos por transacao) para o log; o token nunca entra aqui.
      const errs = (data?.errors || []).map((e) => [e.code, e.message, ...(e.details || [])].filter(Boolean).join(' | '));
      const detail = errs.join(' || ') || data?.message || data?.error || `HTTP ${res.status}`;
      const err = new Error(`Mercado Pago (HTTP ${res.status}): ${detail}`);
      err.mp = data;
      throw err;
    }
    return data;
  }
}

const notificationUrl = () =>
  config.publicUrl.startsWith('https://') ? `${config.publicUrl}/api/webhooks/mercadopago` : undefined;
const reais = (cents) => (cents / 100).toFixed(2);

export async function createPix(order) {
  const [first, ...rest] = String(order.buyer_name || 'Cliente').trim().split(/\s+/);
  const payer = { email: order.buyer_email, first_name: first, last_name: rest.join(' ') || first };
  const cpf = String(order.buyer_cpf || '').replace(/\D/g, '');
  if (cpf.length === 11) payer.identification = { type: 'CPF', number: cpf };
  const data = await mp('/v1/orders', {
    method: 'POST',
    idempotency: `pix-${order.code}-${crypto.randomBytes(6).toString('hex')}`,
    body: {
      type: 'online',
      processing_mode: 'automatic',
      external_reference: order.code,
      total_amount: reais(order.total_cents),
      payer,
      transactions: {
        payments: [{
          amount: reais(order.total_cents),
          payment_method: { id: 'pix', type: 'bank_transfer' },
          expiration_time: 'PT1H',
        }],
      },
    },
  });
  const pm = data.transactions?.payments?.[0]?.payment_method || {};
  if (!data.id || !pm.qr_code) throw new Error('Mercado Pago nao devolveu o QR Code do Pix');
  return {
    paymentId: String(data.id), // id da order (ORD...)
    qr: pm.qr_code,
    qrBase64: pm.qr_code_base64,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

export async function createCheckout(order, items) {
  const data = await mp('/checkout/preferences', {
    method: 'POST',
    idempotency: `pref-${order.code}-${crypto.randomBytes(4).toString('hex')}`,
    body: {
      items: [{
        id: order.code,
        title: `Fotos Tudo Eh Festa (${items} foto${items > 1 ? 's' : ''})`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: order.total_cents / 100,
      }],
      payer: { email: order.buyer_email, name: order.buyer_name },
      external_reference: order.code,
      notification_url: notificationUrl(),
      back_urls: {
        success: `${config.publicUrl}/pedido/${order.code}`,
        pending: `${config.publicUrl}/pedido/${order.code}`,
        failure: `${config.publicUrl}/pedido/${order.code}`,
      },
      auto_return: 'approved',
      statement_descriptor: 'TUDOEHFESTA',
    },
  });
  return { preferenceId: data.id, url: data.init_point };
}

export async function markOrderPaid(orderId, method) {
  return db.tx(async (t) => {
    const r = await t.query(
      `update orders set status = 'paid', paid_at = now(), payment_method = coalesce($2, payment_method)
        where id = $1 and status = 'pending' returning *`,
      [orderId, method || null],
    );
    const order = r.rows[0];
    if (order) {
      await t.query(
        `update photos set needs_copy = true where original_path like 'drive:%' and id in (select photo_id from order_items where order_id = $1)`,
        [order.id],
      );
    }
    if (order?.coupon_code) {
      await t.query('update coupons set uses = uses + 1 where upper(code) = upper($1)', [order.coupon_code]);
    }
    return order || null;
  });
}

// Confere direto na API (nunca confia no corpo do webhook). Aceita id de order (ORD..., Pix) ou de
// payment (numero, Checkout Pro do cartao).
export async function syncPayment(id) {
  if (!mpEnabled() || !id) return null;
  id = String(id);
  let ref;
  let paid = false;
  let paidCents = 0;
  let method = 'pix';
  if (/^ORD/i.test(id)) {
    const o = await mp(`/v1/orders/${encodeURIComponent(id)}`);
    ref = o.external_reference;
    paid = o.status === 'processed' && o.status_detail === 'accredited';
    paidCents = Math.round(Number(o.total_paid_amount || o.total_amount) * 100);
    method = o.transactions?.payments?.[0]?.payment_method?.id === 'pix' ? 'pix' : 'cartao';
  } else {
    const p = await mp(`/v1/payments/${encodeURIComponent(id)}`);
    ref = p.external_reference;
    paid = p.status === 'approved';
    paidCents = Math.round(Number(p.transaction_amount) * 100);
    method = p.payment_method_id === 'pix' ? 'pix' : 'cartao';
  }
  if (!ref) return null;
  const order = await db.one('select * from orders where code = $1', [ref]);
  if (!order || !paid || order.status !== 'pending') return order;
  if (paidCents < order.total_cents) {
    console.warn('[mp] valor pago menor que o pedido', order.code, paidCents, order.total_cents);
    return order;
  }
  await db.query('update orders set mp_payment_id = $2 where id = $1', [order.id, id]);
  const done = await markOrderPaid(order.id, method);
  if (done) console.log('[mp] pedido pago', order.code, id, method);
  return done || order;
}

export async function findPaymentsByReference(code) {
  if (!mpEnabled()) return [];
  const data = await mp(`/v1/payments/search?external_reference=${encodeURIComponent(code)}&sort=date_created&criteria=desc`);
  return data.results || [];
}

export { ipHandle, ipEnabled, createInfinitePayLink, checkInfinitePay } from './infinitepay.js';
import { ipEnabled } from './infinitepay.js';

// Qual servico atende cada forma de pagamento (configuravel no admin quando os dois estao ativos).
export async function paymentOptions() {
  const mp = mpEnabled();
  const ip = ipEnabled();
  const cfg = (await getSetting('payments', {})) || {};
  const pick = (want, order) => (want === 'mercadopago' && mp) || (want === 'infinitepay' && ip) ? want : order.find((x) => (x === 'mercadopago' ? mp : ip)) || null;
  return {
    mercadopago: mp,
    infinitepay: ip,
    pix: pick(cfg.pix, ['mercadopago', 'infinitepay']) || 'manual',
    card: pick(cfg.card, ['infinitepay', 'mercadopago']),
  };
}
