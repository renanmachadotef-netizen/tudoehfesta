import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Trash2, Tag, CreditCard, QrCode, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSite, useTitle } from '../lib/site.jsx';
import { cart, useCart } from '../lib/cart.js';
import { money } from '../lib/format.js';
import { Empty } from '../components/Layout.jsx';
import { AuthForm } from './Auth.jsx';

export default function Cart() {
  useTitle('Carrinho');
  const { user, payments } = useSite();
  const { items, coupon } = useCart();
  const nav = useNavigate();
  const [price, setPrice] = useState(null);
  const [couponText, setCouponText] = useState(coupon);
  const [method, setMethod] = useState('pix');
  const [cpf, setCpf] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = items.map((i) => i.id);
  const key = ids.join(',') + '|' + coupon;

  useEffect(() => {
    if (!ids.length) return setPrice(null);
    api('/cart/price', { method: 'POST', body: { photoIds: ids, coupon } }).then(setPrice).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Fotos que sairam do ar (evento oculto) somem do carrinho.
  useEffect(() => {
    if (!price) return;
    const valid = new Set(price.items.map((i) => i.photo_id));
    const gone = ids.filter((id) => !valid.has(id));
    if (gone.length) cart.remove(gone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price]);

  const checkout = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api('/orders', { method: 'POST', body: { photoIds: ids, coupon, method, cpf } });
      cart.clear();
      if (d.redirect) window.location.href = d.redirect;
      else nav(`/pedido/${d.code}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!items.length) {
    return (
      <div className="container section">
        <Empty icon={ShoppingBag} title="Seu carrinho está vazio">
          <span>Encontre suas fotos com uma selfie ou navegue pelos eventos.</span>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to="/buscar" className="btn btn-accent">Achar minhas fotos</Link>
            <Link to="/eventos" className="btn btn-ghost">Ver eventos</Link>
          </div>
        </Empty>
      </div>
    );
  }

  const byEvent = new Map();
  for (const it of items) {
    const k = it.event_slug || it.event_id;
    if (!byEvent.has(k)) byEvent.set(k, { title: it.event_title, slug: it.event_slug, items: [] });
    byEvent.get(k).items.push(it);
  }
  const groupPrice = (slug) => price?.groups.find((g) => g.slug === slug);
  const freshThumb = new Map((price?.items || []).map((i) => [i.photo_id, i.thumb]));

  return (
    <div className="container section-sm">
      <h1 style={{ fontSize: 'clamp(28px,4vw,40px)', marginBottom: 24 }}>Carrinho</h1>
      <div className="cart-layout">
        <div className="stack" style={{ gap: 24 }}>
          {[...byEvent.values()].map((g) => {
            const gp = groupPrice(g.slug);
            return (
              <div key={g.slug} className="card stack" style={{ gap: 14 }}>
                <div className="row between">
                  <Link to={`/evento/${g.slug}`}><h3>{g.title}</h3></Link>
                  <div className="row" style={{ gap: 8 }}>
                    {gp?.tier_pct > 0 && <span className="badge badge-accent">-{gp.tier_pct}%</span>}
                    {gp?.pack_applied && <span className="badge badge-ok">Pacote</span>}
                    {gp && <b>{money(gp.total_cents)}</b>}
                  </div>
                </div>
                <div className="studio-photos" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
                  {g.items.map((it) => (
                    <div key={it.id} className="studio-photo">
                      <img src={freshThumb.get(it.id) || it.thumb} alt="" loading="lazy" />
                      <div className="acts" style={{ display: 'flex' }}>
                        <button onClick={() => cart.remove(it.id)} aria-label="Remover"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
                {gp && gp.base_cents !== gp.total_cents && (
                  <span className="small muted">{g.items.length} × {money(gp.unit_cents)} = <s>{money(gp.base_cents)}</s> → <b style={{ color: 'var(--ok)' }}>{money(gp.total_cents)}</b></span>
                )}
              </div>
            );
          })}
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => cart.clear()}>Esvaziar carrinho</button>
        </div>

        <aside className="card stack cart-aside">
          <h3>Resumo</h3>
          <div className="row between small"><span className="muted">{items.length} fotos</span><span>{money(price?.subtotal)}</span></div>
          {price?.discount > 0 && <div className="row between small" style={{ color: 'var(--ok)' }}><span>Descontos</span><span>-{money(price.discount)}</span></div>}
          <div className="row between" style={{ fontSize: 20 }}><b>Total</b><b>{money(price?.total)}</b></div>

          <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); cart.setCoupon(couponText.trim().toUpperCase()); }}>
            <div className="grow" style={{ position: 'relative' }}>
              <Tag size={15} style={{ position: 'absolute', left: 12, top: 15 }} color="#74706a" />
              <input className="input" style={{ paddingLeft: 34, height: 44 }} placeholder="Cupom" value={couponText} onChange={(e) => setCouponText(e.target.value)} />
            </div>
            <button className="btn btn-soft">Aplicar</button>
          </form>
          {price?.coupon?.invalid && <span className="tiny" style={{ color: 'var(--bad)' }}>Cupom inválido ou esgotado.</span>}
          {price?.coupon?.applied && <span className="tiny" style={{ color: 'var(--ok)' }}>Cupom {price.coupon.code} aplicado ({price.coupon.pct}%).</span>}
          {price?.coupon && !price.coupon.invalid && !price.coupon.applied && <span className="tiny muted">Este cupom não vale para as fotos do carrinho.</span>}

          {!user ? (
            <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <b>Entre para finalizar</b>
              <span className="small muted">Suas fotos ficam guardadas na sua conta.</span>
              <AuthForm initial="register" />
            </div>
          ) : (
            <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <b>Pagamento</b>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <button type="button" className={`btn grow ${method === 'pix' ? '' : 'btn-ghost'}`} onClick={() => setMethod('pix')}><QrCode size={17} /> Pix</button>
                {payments?.card && (
                  <button type="button" className={`btn grow ${method === 'card' ? '' : 'btn-ghost'}`} onClick={() => setMethod('card')}><CreditCard size={17} /> Cartão</button>
                )}
              </div>
              {payments?.pix === 'mercadopago' && method === 'pix' && (
                <label className="field"><span>CPF <small>(opcional, aparece no comprovante)</small></span>
                  <input className="input" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
                </label>
              )}
              {((method === 'pix' && payments?.pix === 'infinitepay') || (method === 'card' && payments?.card === 'infinitepay')) && (
                <span className="tiny muted">Você vai para a página segura da InfinitePay e volta aqui com as fotos liberadas.</span>
              )}
              {method === 'card' && payments?.card === 'mercadopago' && <span className="tiny muted">Você vai para a página segura do Mercado Pago.</span>}
              {error && <div className="alert alert-bad">{error}</div>}
              <button className="btn btn-accent btn-lg" disabled={busy || !price?.total} onClick={checkout}>
                {busy ? 'Gerando pagamento…' : `Pagar ${money(price?.total)}`}
              </button>
              <span className="tiny muted row" style={{ gap: 6 }}><Lock size={13} /> Pagamento seguro. Fotos liberadas assim que o pagamento for confirmado.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
