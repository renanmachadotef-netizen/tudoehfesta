import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';

// Mercado Pago: Pix direto (QR na tela) e Checkout Pro (cartao, redireciona).
// Sem MP_ACCESS_TOKEN o site funciona em "Pix manual": mostra a chave Pix do site e o admin
// confirma o pedido no painel quando o dinheiro cair.

const MP = 'https://api.mercadopago.com';
export const mpEnabled = () => !!config.mpAccessToken;

async function mp(pathname, { method = 'GET', body, idempotency } = {}) {
  const res = await fetch(MP + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${config.mpAccessToken}`,
      'Content-Type': 'application/json',
      ...(idempotency ? { 'X-Idempotency-Key': idempotency } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`Mercado Pago: ${msg}`);
  }
  return data;
}

const notificationUrl = () =>
  config.publicUrl.startsWith('https://') ? `${config.publicUrl}/api/webhooks/mercadopago` : undefined;

export async function createPix(order) {
  const [first, ...rest] = String(order.buyer_name || 'Cliente').trim().split(/\s+/);
  const payer = { email: order.buyer_email, first_name: first, last_name: rest.join(' ') || first };
  const cpf = String(order.buyer_cpf || '').replace(/\D/g, '');
  if (cpf.length === 11) payer.identification = { type: 'CPF', number: cpf };
  const data = await mp('/v1/payments', {
    method: 'POST',
    idempotency: `pix-${order.code}-${crypto.randomBytes(4).toString('hex')}`,
    body: {
      transaction_amount: order.total_cents / 100,
      description: `Fotos Tudo Eh Festa - pedido ${order.code}`,
      payment_method_id: 'pix',
      external_reference: order.code,
      notification_url: notificationUrl(),
      date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString().replace('Z', '-00:00'),
      payer,
    },
  });
  const tx = data.point_of_interaction?.transaction_data || {};
  return {
    paymentId: String(data.id),
    qr: tx.qr_code,
    qrBase64: tx.qr_code_base64,
    expiresAt: data.date_of_expiration,
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
    if (order?.coupon_code) {
      await t.query('update coupons set uses = uses + 1 where upper(code) = upper($1)', [order.coupon_code]);
    }
    return order || null;
  });
}

// Confere o pagamento direto na API (nunca confia no corpo do webhook).
export async function syncPayment(paymentId) {
  if (!mpEnabled() || !paymentId) return null;
  const p = await mp(`/v1/payments/${encodeURIComponent(paymentId)}`);
  if (!p.external_reference) return null;
  const order = await db.one('select * from orders where code = $1', [p.external_reference]);
  if (!order) return null;
  if (p.status === 'approved' && order.status === 'pending') {
    if (Math.round(Number(p.transaction_amount) * 100) < order.total_cents) {
      console.warn('[mp] valor pago menor que o pedido', order.code, p.transaction_amount);
      return order;
    }
    await db.query('update orders set mp_payment_id = $2 where id = $1', [order.id, String(p.id)]);
    return markOrderPaid(order.id, p.payment_method_id === 'pix' ? 'pix' : 'cartao');
  }
  return order;
}

export async function findPaymentsByReference(code) {
  if (!mpEnabled()) return [];
  const data = await mp(`/v1/payments/search?external_reference=${encodeURIComponent(code)}&sort=date_created&criteria=desc`);
  return data.results || [];
}
