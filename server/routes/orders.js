import path from 'node:path';
import { Router } from 'express';
import { Zip, ZipPassThrough } from 'fflate';
import { db } from '../db.js';
import { requireUser } from '../auth.js';
import { priceCart, getSetting } from '../pricing.js';
import { createPix, createCheckout, mpEnabled, syncPayment, findPaymentsByReference, paymentOptions, createInfinitePayLink, checkInfinitePay } from '../payments.js';
import { originalStream, withOriginal } from '../originals.js';
import { blurredOriginal } from '../storage.js';
import { blurBoxesFor } from '../matching.js';
import { photoOut } from './public.js';
import { fail, orderCode, cleanText, rateLimit } from '../util.js';
import { activity } from '../activity.js';

const r = Router();

async function loadOrder(code, user) {
  const order = await db.one('select * from orders where code = $1', [String(code).toUpperCase()]);
  if (!order || (order.user_id !== user.id && user.role !== 'admin')) fail(404, 'Pedido não encontrado.');
  return order;
}

async function orderOut(order) {
  const items = await db.many(
    `select oi.photo_id as id, oi.event_id, oi.price_cents, p.width, p.height, p.key, e.title as event_title, e.slug as event_slug
       from order_items oi join photos p on p.id = oi.photo_id join events e on e.id = oi.event_id
      where oi.order_id = $1 order by oi.event_id, oi.photo_id`,
    [order.id],
  );
  const site = await getSetting('site', {});
  return {
    code: order.code,
    status: order.status,
    subtotal_cents: order.subtotal_cents,
    discount_cents: order.discount_cents,
    total_cents: order.total_cents,
    payment_method: order.payment_method,
    pix_qr: order.status === 'pending' ? order.pix_qr : null,
    pix_qr_base64: order.status === 'pending' ? order.pix_qr_base64 : null,
    pix_expires_at: order.pix_expires_at,
    checkout_url: order.status === 'pending' ? order.checkout_url : null,
    payment_provider: order.payment_provider,
    receipt_url: order.ip_receipt_url,
    installments: order.installments,
    manual_pix: order.payment_method === 'pix_manual' && order.status === 'pending'
      ? { key: site.pix_key || '', name: site.pix_name || '', whatsapp: site.whatsapp || '' }
      : null,
    created_at: order.created_at,
    paid_at: order.paid_at,
    items: items.map((i) => ({ ...photoOut(i), price_cents: i.price_cents, event_title: i.event_title, event_slug: i.event_slug })),
  };
}

r.post('/orders', requireUser, rateLimit('orders', 20, 60_000), async (req, res) => {
  const { photoIds, coupon, method = 'pix', cpf } = req.body || {};
  // WhatsApp obrigatorio: pre-preenche o checkout e permite suporte/recuperacao do pedido.
  const phone = cleanText(req.body?.phone || req.user.phone, 30);
  if (String(phone || '').replace(/\D/g, '').length < 10) fail(400, 'Informe seu WhatsApp com DDD para finalizar o pedido.');
  if (phone !== req.user.phone) await db.query('update users set phone = $2 where id = $1', [req.user.id, phone]);
  const priced = await priceCart(photoIds, coupon);
  if (!priced.items.length) fail(400, 'Seu carrinho está vazio.');
  if (priced.total < 100) fail(400, 'Valor mínimo do pedido: R$ 1,00.');

  // Fotos ja compradas pelo cliente nao entram de novo.
  const owned = await db.many(
    `select oi.photo_id from order_items oi join orders o on o.id = oi.order_id
      where o.user_id = $1 and o.status = 'paid' and oi.photo_id = any($2::int[])`,
    [req.user.id, priced.items.map((i) => i.photo_id)],
  );
  if (owned.length) fail(409, `Você já comprou ${owned.length} dessas fotos. Veja em "Minhas fotos".`);

  const opts = await paymentOptions();
  const provider = method === 'card' && opts.card ? opts.card : opts.pix;
  const payMethod = provider === 'manual' ? 'pix_manual' : method === 'card' && opts.card ? 'cartao' : 'pix';
  const order = await db.tx(async (t) => {
    const o = (await t.query(
      `insert into orders (code, user_id, subtotal_cents, discount_cents, total_cents, payment_method, buyer_name, buyer_email, buyer_cpf, coupon_code, payment_provider)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [orderCode(), req.user.id, priced.subtotal, priced.discount, priced.total, payMethod, req.user.name, req.user.email,
        cleanText(String(cpf || '').replace(/\D/g, ''), 11), priced.coupon?.applied ? priced.coupon.code : null, provider],
    )).rows[0];
    for (const it of priced.items) {
      await t.query(
        `insert into order_items (order_id, photo_id, event_id, photographer_id, price_cents, commission_cents, photographer_cents)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [o.id, it.photo_id, it.event_id, it.photographer_id, it.price_cents, it.commission_cents, it.photographer_cents],
      );
    }
    return o;
  });
  activity('pedido', `Novo pedido ${order.code}: ${priced.items.length} foto(s) · R$ ${(order.total_cents / 100).toFixed(2).replace('.', ',')} (${payMethod})`);

  let redirect = null;
  try {
    if (provider === 'infinitepay') {
      redirect = await createInfinitePayLink(order, priced.groups, phone);
      await db.query('update orders set checkout_url = $2 where id = $1', [order.id, redirect]);
    } else if (payMethod === 'pix') {
      try {
        const pix = await createPix(order);
        await db.query(
          'update orders set mp_payment_id = $2, pix_qr = $3, pix_qr_base64 = $4, pix_expires_at = $5 where id = $1',
          [order.id, pix.paymentId, pix.qr, pix.qrBase64, pix.expiresAt],
        );
      } catch (err) {
        // Pix do Mercado Pago recusado: se a InfinitePay estiver ativa, o cliente paga por ela em vez de ver erro.
        if (!opts.infinitepay) throw err;
        console.error('[pedido] Pix Mercado Pago falhou, usando InfinitePay:', order.code, err.message, err.mp ? JSON.stringify(err.mp).slice(0, 1500) : '');
        redirect = await createInfinitePayLink(order, priced.groups, phone);
        await db.query(`update orders set payment_provider = 'infinitepay', checkout_url = $2 where id = $1`, [order.id, redirect]);
      }
    } else if (payMethod === 'cartao') {
      const pref = await createCheckout(order, priced.items.length);
      await db.query('update orders set mp_preference_id = $2, checkout_url = $3 where id = $1', [order.id, pref.preferenceId, pref.url]);
      redirect = pref.url;
    }
  } catch (err) {
    console.error('[pedido]', order.code, err.message, err.mp ? JSON.stringify(err.mp).slice(0, 1500) : '');
    await db.query(`update orders set status = 'cancelled' where id = $1`, [order.id]);
    fail(503, 'Não conseguimos gerar o pagamento agora. Tente de novo em instantes ou escolha outra forma de pagamento.');
  }
  res.json({ code: order.code, redirect });
});

r.get('/orders/:code', requireUser, async (req, res) => {
  let order = await loadOrder(req.params.code, req.user);
  // Se o webhook atrasar, confere direto no Mercado Pago quando o cliente esta olhando o pedido.
  if (order.status === 'pending' && order.payment_provider === 'infinitepay') {
    try {
      const transactionNsu = String(req.query.transaction_nsu || order.ip_transaction_nsu || '');
      const slug = String(req.query.slug || order.ip_slug || '');
      if (transactionNsu && slug) {
        await checkInfinitePay(order, { transactionNsu, slug, receiptUrl: String(req.query.receipt_url || '') });
        order = await loadOrder(req.params.code, req.user);
      }
    } catch (err) {
      console.warn('[pedido] infinitepay', err.message);
    }
  } else if (order.status === 'pending' && mpEnabled()) {
    try {
      if (order.mp_payment_id) await syncPayment(order.mp_payment_id);
      else if (order.mp_preference_id) {
        for (const p of await findPaymentsByReference(order.code)) if (p.status === 'approved') await syncPayment(p.id);
      }
      order = await loadOrder(req.params.code, req.user);
    } catch (err) {
      console.warn('[pedido] sync', err.message);
    }
  }
  res.json({ order: await orderOut(order) });
});

r.post('/orders/:code/pix', requireUser, async (req, res) => {
  const order = await loadOrder(req.params.code, req.user);
  if (order.status !== 'pending' || !mpEnabled()) fail(400, 'Pedido não está aguardando pagamento.');
  const pix = await createPix(order);
  await db.query(
    `update orders set payment_method = 'pix', mp_payment_id = $2, pix_qr = $3, pix_qr_base64 = $4, pix_expires_at = $5 where id = $1`,
    [order.id, pix.paymentId, pix.qr, pix.qrBase64, pix.expiresAt],
  );
  res.json({ ok: true });
});

r.get('/my/orders', requireUser, async (req, res) => {
  const rows = await db.many(
    `select o.code, o.status, o.total_cents, o.created_at, o.paid_at, count(oi.id)::int as items
       from orders o join order_items oi on oi.order_id = o.id
      where o.user_id = $1 group by o.id order by o.created_at desc limit 100`,
    [req.user.id],
  );
  res.json({ orders: rows });
});

r.get('/my/photos', requireUser, async (req, res) => {
  const rows = await db.many(
    `select distinct on (p.id) p.id, p.event_id, p.width, p.height, p.key, e.title as event_title, e.slug as event_slug, e.event_date, o.paid_at
       from order_items oi join orders o on o.id = oi.order_id and o.status = 'paid'
       join photos p on p.id = oi.photo_id join events e on e.id = p.event_id
      where o.user_id = $1 order by p.id`,
    [req.user.id],
  );
  rows.sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)) || a.id - b.id);
  res.json({
    photos: rows.map((p) => ({ ...photoOut(p), event_title: p.event_title, event_slug: p.event_slug, event_date: p.event_date })),
  });
});

async function ownedPhotos(user, ids) {
  if (user.role === 'admin') {
    return db.many('select p.id, p.original_path, p.original_name, e.slug as event_slug from photos p join events e on e.id = p.event_id where p.id = any($1::int[])', [ids]);
  }
  return db.many(
    `select distinct p.id, p.original_path, p.original_name, e.slug as event_slug
       from photos p join events e on e.id = p.event_id
       left join order_items oi on oi.photo_id = p.id
       left join orders o on o.id = oi.order_id and o.status = 'paid' and o.user_id = $2
      where p.id = any($1::int[]) and (o.id is not null or e.photographer_id = $2)`,
    [ids, user.id],
  );
}

const downloadName = (p) => `tudoehfesta-${p.event_slug}-${p.id}${path.extname(p.original_name || p.original_path) || '.jpg'}`;

r.get('/download/:photoId', requireUser, async (req, res) => {
  const [p] = await ownedPhotos(req.user, [Number(req.params.photoId)]);
  if (!p) fail(404, 'Foto não encontrada nas suas compras.');
  // Quem pediu "borrar minhas imagens" sai borrado tambem no original de quem compra (menos para ele mesmo).
  const boxes = await blurBoxesFor(p.id, req.user.id);
  if (boxes.length) {
    const buf = await withOriginal(p.original_path, (file) => blurredOriginal(file, boxes));
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName(p).replace(/.w+$/, '.jpg')}"`);
    return res.end(buf);
  }
  const stream = await originalStream(p.original_path);
  const ext = path.extname(downloadName(p)).toLowerCase();
  res.setHeader('Content-Type', ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName(p)}"`);
  stream.on('error', (err) => res.destroy(err));
  stream.pipe(res);
});

// Baixa varias fotos num .zip sem comprimir (JPEG ja e comprimido): sai rapido e sem pesar no servidor.
r.get('/download-zip', requireUser, async (req, res) => {
  let ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  if (req.query.order) {
    const order = await loadOrder(req.query.order, req.user);
    ids = (await db.many('select photo_id from order_items where order_id = $1', [order.id])).map((x) => x.photo_id);
  }
  const photos = await ownedPhotos(req.user, ids.slice(0, 1000));
  if (!photos.length) fail(404, 'Nenhuma foto disponível para baixar.');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="tudoehfesta-fotos-${Date.now()}.zip"`);
  const zip = new Zip((err, chunk, final) => {
    if (err) return res.destroy(err);
    res.write(Buffer.from(chunk));
    if (final) res.end();
  });
  for (const p of photos) {
    const boxes = await blurBoxesFor(p.id, req.user.id);
    if (boxes.length) {
      const entry = new ZipPassThrough(downloadName(p).replace(/.w+$/, '.jpg'));
      zip.add(entry);
      const buf = await withOriginal(p.original_path, (file) => blurredOriginal(file, boxes));
      entry.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), true);
      continue;
    }
    const entry = new ZipPassThrough(downloadName(p));
    zip.add(entry);
    const s = await originalStream(p.original_path);
    await new Promise((resolve, reject) => {
      s.on('data', (c) => entry.push(new Uint8Array(c.buffer, c.byteOffset, c.byteLength)));
      s.on('end', () => {
        entry.push(new Uint8Array(0), true);
        resolve();
      });
      s.on('error', reject);
    });
  }
  zip.end();
});

// Webhook da InfinitePay: confere no payment_check antes de liberar. 400 faz a InfinitePay reenviar.
r.post('/webhooks/infinitepay', async (req, res) => {
  const b = req.body || {};
  try {
    const order = await db.one('select * from orders where code = $1', [String(b.order_nsu || '').toUpperCase()]);
    if (!order) return res.sendStatus(200);
    const after = await checkInfinitePay(order, { transactionNsu: b.transaction_nsu, slug: b.invoice_slug || b.slug, receiptUrl: b.receipt_url });
    res.sendStatus(after.status === 'paid' || order.status !== 'pending' ? 200 : 400);
  } catch (err) {
    console.error('[webhook infinitepay]', err.message);
    res.sendStatus(400);
  }
});

// Webhook do Mercado Pago: so usa o id; o status e conferido direto na API.
r.post('/webhooks/mercadopago', async (req, res) => {
  // Orders: ?type=order&data.id=ORD... (corpo com action "order.processed"); Checkout Pro: type=payment.
  const type = req.body?.type || req.query.type || req.query.topic;
  const id = req.body?.data?.id || req.query['data.id'] || (req.query.topic === 'payment' ? req.query.id : null);
  res.sendStatus(200);
  if (id && (!type || type === 'order' || type === 'payment')) {
    syncPayment(String(id)).catch((err) => console.error('[webhook mp]', err.message));
  }
});

export default r;
