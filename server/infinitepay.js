import { config } from './config.js';
import { db } from './db.js';
import { markOrderPaid } from './payments.js';

// InfinitePay - Checkout Integrado (https://www.infinitepay.io/checkout-documentacao)
//   POST /links          cria o link de pagamento hospedado (Pix ou cartao ate 12x) -> { url }
//   POST /payment_check  confere um pagamento -> { success, paid, amount, paid_amount, installments, capture_method }
// Sem chave secreta: o lojista e identificado pela InfiniteTag (INFINITEPAY_HANDLE). O webhook nao e
// assinado, entao NENHUM aviso libera fotos sozinho: tudo passa pelo payment_check.
//
// Comportamentos confirmados na API real (21/10/2026):
//   - qualquer caractere fora do ASCII (acento, cedilha, travessao, "o" ordinal) em description OU no nome do
//     comprador -> HTTP 400 {"success":false,"error":"Bad Request"}, mesmo escapado no JSON;
//   - price 0 -> HTTP 422; price em centavos;
//   - transacao inexistente ou nao paga no payment_check -> HTTP 200 {"success":false}.

const API = 'https://api.checkout.infinitepay.io';
const TIMEOUT_MS = 10_000;
const POLL_SECONDS = Math.max(3, Number(process.env.INFINITEPAY_POLL_SECONDS) || 120);

export const ipHandle = () => String(process.env.INFINITEPAY_HANDLE || '').trim().replace(/^\$/, '');
export const ipEnabled = () => !!ipHandle();

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.error('[infinitepay] ATENCAO: NODE_TLS_REJECT_UNAUTHORIZED=0 desliga a verificacao TLS. Remova essa variavel.');
}

// "João – Formatura 35º" -> "Joao - Formatura 35o"
export function asciiSafe(text, max = 120) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/º/g, 'o')
    .replace(/ª/g, 'a')
    .replace(/ß/g, 'ss')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// "(48) 99999-0000" -> "+5548999990000"; vazio se nao parecer telefone brasileiro.
export function phoneE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return `+${d}`;
  return '';
}

// HTTPS com verificacao de certificado (padrao do fetch do Node), tempo limite e 1 nova tentativa em falha de rede/5xx.
async function ipPost(path, body, { retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt < retries) continue;
      const why = err.name === 'TimeoutError' ? `sem resposta em ${TIMEOUT_MS / 1000}s` : err.cause?.code || err.message;
      throw new Error(`InfinitePay indisponivel (${why})`);
    }
    if (res.status >= 500 && attempt < retries) continue;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`InfinitePay recusou ${path} (HTTP ${res.status}${data.error ? `: ${data.error}` : ''})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
}

// Uma linha por evento com quantidade e preco unitario (ja com desconto). Quando o total do evento nao
// divide em centavos exatos pela quantidade, vai como "N fotos" x1. A soma sempre bate com o pedido.
export function checkoutItems(order, groups) {
  const items = [];
  for (const g of groups || []) {
    if (!g.total_cents) continue;
    const title = asciiSafe(g.title, 90) || 'Evento';
    if (g.count > 1 && g.total_cents % g.count === 0) {
      items.push({ quantity: g.count, price: g.total_cents / g.count, description: `Fotos - ${title}` });
    } else {
      items.push({ quantity: 1, price: g.total_cents, description: g.count > 1 ? `${g.count} fotos - ${title}` : `Foto - ${title}` });
    }
  }
  const sum = items.reduce((s, i) => s + i.quantity * i.price, 0);
  if (!items.length || sum !== order.total_cents) {
    return [{ quantity: 1, price: order.total_cents, description: `Fotos Tudo Eh Festa - pedido ${order.code}` }];
  }
  return items;
}

export async function createInfinitePayLink(order, groups, phone) {
  const customer = { name: asciiSafe(order.buyer_name, 80) || 'Cliente', email: order.buyer_email };
  const tel = phoneE164(phone);
  if (tel) customer.phone_number = tel;
  const https = config.publicUrl.startsWith('https://');
  const data = await ipPost('/links', {
    handle: ipHandle(),
    items: checkoutItems(order, groups),
    order_nsu: order.code,
    redirect_url: `${config.publicUrl}/pedido/${order.code}`,
    ...(https ? { webhook_url: `${config.publicUrl}/api/webhooks/infinitepay` } : {}),
    customer,
  });
  if (!data.url || !/^https:\/\//.test(data.url)) throw new Error('InfinitePay nao devolveu o link de pagamento');
  return data.url;
}

// Confere o pagamento na InfinitePay. Chamado pelo webhook, pela volta do cliente e pela verificacao
// periodica. Os dados da transacao vem do webhook/redirect, mas so valem depois do payment_check.
export async function checkInfinitePay(order, { transactionNsu, slug, receiptUrl } = {}) {
  if (!ipEnabled() || order.status !== 'pending') return order;
  transactionNsu = transactionNsu || order.ip_transaction_nsu;
  slug = slug || order.ip_slug;
  if (!transactionNsu || !slug) return order;
  await db.query(
    `update orders set ip_slug = $2, ip_transaction_nsu = $3, ip_checked_at = now(),
       ip_receipt_url = coalesce($4, ip_receipt_url) where id = $1`,
    [order.id, String(slug).slice(0, 120), String(transactionNsu).slice(0, 120), /^https:\/\//.test(receiptUrl || '') ? receiptUrl : null],
  );
  const r = await ipPost('/payment_check', { handle: ipHandle(), order_nsu: order.code, transaction_nsu: transactionNsu, slug });
  if (!(r.success && r.paid)) return order;
  if (Number(r.amount) < order.total_cents) {
    console.warn('[infinitepay] valor pago menor que o pedido', order.code, r.amount, order.total_cents);
    return order;
  }
  await db.query('update orders set installments = $2, paid_amount_cents = $3 where id = $1', [
    order.id, Number(r.installments) || null, Number(r.paid_amount) || null,
  ]);
  const paid = await markOrderPaid(order.id, r.capture_method === 'pix' ? 'pix' : 'cartao');
  if (paid) console.log('[infinitepay] pedido pago', order.code, r.capture_method, r.amount);
  return paid || order;
}

// Verificacao periodica (reserva para webhook perdido): pedidos pendentes que ja tem os dados da transacao.
export async function pollPendingInfinitePay() {
  if (!ipEnabled()) return;
  const rows = await db.many(
    `select * from orders where status = 'pending' and payment_provider = 'infinitepay'
        and ip_transaction_nsu is not null and ip_slug is not null
        and (ip_checked_at is null or ip_checked_at < now() - make_interval(secs => $1))
      order by created_at desc limit 5`,
    [POLL_SECONDS],
  );
  for (const o of rows) {
    try {
      await checkInfinitePay(o);
    } catch (err) {
      console.warn('[infinitepay] verificacao', o.code, err.message);
    }
  }
}
