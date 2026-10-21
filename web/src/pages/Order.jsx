import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Copy, Download, MessageCircle, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSite, useTitle } from '../lib/site.jsx';
import { money, dateTimeBR, plural } from '../lib/format.js';
import { Loading, ErrorBox } from '../components/Layout.jsx';
import { AuthForm } from './Auth.jsx';

export default function Order() {
  const { code } = useParams();
  const { user, ready, toast } = useSite();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  useTitle(`Pedido ${code}`);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    let timer;
    const load = async () => {
      try {
        const d = await api(`/orders/${code}`);
        if (!alive) return;
        setOrder(d.order);
        // Enquanto aguarda o Pix, confere a cada 5 s.
        if (d.order.status === 'pending') timer = setTimeout(load, 5000);
      } catch (err) {
        if (alive) setError(err);
      }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [code, user]);

  if (ready && !user) {
    return <div className="container"><div className="auth-wrap card stack"><h3>Entre para ver seu pedido</h3><AuthForm /></div></div>;
  }
  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!order) return <Loading />;

  const copy = async (text) => {
    await navigator.clipboard?.writeText(text);
    toast('Código Pix copiado!');
  };

  return (
    <div className="container section-sm stack" style={{ gap: 24, maxWidth: 900 }}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Pedido {order.code}</span>
        <h1 style={{ fontSize: 'clamp(26px,4vw,38px)' }}>
          {order.status === 'paid' && 'Pagamento confirmado!'}
          {order.status === 'pending' && 'Aguardando pagamento'}
          {order.status === 'cancelled' && 'Pedido cancelado'}
          {order.status === 'refunded' && 'Pedido estornado'}
        </h1>
        <span className="muted small">{plural(order.items.length, 'foto', 'fotos')} · {money(order.total_cents)} · {dateTimeBR(order.created_at)}</span>
      </div>

      {order.status === 'pending' && order.pix_qr && (
        <div className="card row" style={{ gap: 24, alignItems: 'center' }}>
          <img className="qr" src={`data:image/png;base64,${order.pix_qr_base64}`} alt="QR Code Pix" />
          <div className="stack grow" style={{ minWidth: 240 }}>
            <b className="row" style={{ gap: 8 }}><Clock size={18} color="var(--warn)" /> Pague com Pix para liberar suas fotos</b>
            <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>Abra o app do seu banco e escolha Pix.</li>
              <li>Escaneie o QR Code ou use o “copia e cola”.</li>
              <li>Pronto: esta página atualiza sozinha quando o pagamento cair.</li>
            </ol>
            <textarea className="textarea" readOnly value={order.pix_qr} style={{ minHeight: 70, fontSize: 12 }} onFocus={(e) => e.target.select()} />
            <button className="btn btn-accent" onClick={() => copy(order.pix_qr)}><Copy size={16} /> Copiar código Pix</button>
          </div>
        </div>
      )}

      {order.status === 'pending' && order.manual_pix && (
        <div className="card stack">
          <b className="row" style={{ gap: 8 }}><Clock size={18} color="var(--warn)" /> Pague {money(order.total_cents)} via Pix</b>
          {order.manual_pix.key ? (
            <>
              <div className="card-flat stack" style={{ gap: 4 }}>
                <span className="tiny muted">Chave Pix</span>
                <b style={{ wordBreak: 'break-all' }}>{order.manual_pix.key}</b>
                {order.manual_pix.name && <span className="small muted">{order.manual_pix.name}</span>}
              </div>
              <button className="btn btn-soft" onClick={() => copy(order.manual_pix.key)}><Copy size={16} /> Copiar chave</button>
            </>
          ) : <p className="small muted">Fale com a gente pelo WhatsApp para receber a chave Pix.</p>}
          {order.manual_pix.whatsapp && (
            <a className="btn btn-accent" target="_blank" rel="noreferrer"
              href={`https://wa.me/${order.manual_pix.whatsapp}?text=${encodeURIComponent(`Olá! Fiz o Pix do pedido ${order.code} (${money(order.total_cents)}). Segue o comprovante.`)}`}>
              <MessageCircle size={17} /> Enviar comprovante no WhatsApp
            </a>
          )}
          <span className="tiny muted">Assim que confirmarmos o pagamento, suas fotos aparecem aqui e em “Minhas fotos”.</span>
        </div>
      )}

      {order.status === 'pending' && !order.pix_qr && !order.manual_pix && (
        <div className="alert alert-warn">Estamos aguardando a confirmação do pagamento pelo Mercado Pago. Esta página atualiza sozinha.</div>
      )}

      {order.status === 'paid' && (
        <div className="alert alert-ok row" style={{ gap: 10 }}>
          <CheckCircle2 size={18} /> Suas fotos estão liberadas em alta resolução, sem marca d’água. Elas também ficam em “Minhas fotos”.
        </div>
      )}
      {(order.status === 'cancelled' || order.status === 'refunded') && (
        <div className="alert alert-bad row" style={{ gap: 10 }}><XCircle size={18} /> Este pedido não está ativo. Se precisar de ajuda, fale com a gente.</div>
      )}

      {order.status === 'paid' && (
        <div className="row">
          <a className="btn btn-accent" href={`/api/download-zip?order=${order.code}`}><Download size={17} /> Baixar todas (.zip)</a>
          <Link to="/minhas-fotos" className="btn btn-ghost">Minhas fotos</Link>
        </div>
      )}

      <div className="studio-photos">
        {order.items.map((p) => (
          <div key={p.id} className="studio-photo">
            <img src={p.thumb} alt="" loading="lazy" />
            {order.status === 'paid' && (
              <div className="ov"><span /><a className="badge" style={{ background: '#fff' }} href={`/api/download/${p.id}`}><Download size={12} /> Baixar</a></div>
            )}
          </div>
        ))}
      </div>

      <div className="card-flat small stack" style={{ gap: 4 }}>
        <div className="row between"><span className="muted">Subtotal</span><span>{money(order.subtotal_cents)}</span></div>
        {order.discount_cents > 0 && <div className="row between" style={{ color: 'var(--ok)' }}><span>Descontos</span><span>-{money(order.discount_cents)}</span></div>}
        <div className="row between"><b>Total</b><b>{money(order.total_cents)}</b></div>
      </div>
    </div>
  );
}
