import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Images, Receipt } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSite, useTitle } from '../lib/site.jsx';
import { money, dateBR, dateTimeBR } from '../lib/format.js';
import { Loading, Empty } from '../components/Layout.jsx';
import { PhotoGrid } from '../components/Photos.jsx';
import { AuthForm } from './Auth.jsx';
import { MatchedPhotos, FacePrivacy } from './FaceAccount.jsx';

const STATUS = { paid: ['Pago', 'badge-ok'], pending: ['Aguardando', 'badge-warn'], cancelled: ['Cancelado', 'badge-bad'], refunded: ['Estornado', 'badge-bad'] };
export const StatusBadge = ({ status }) => <span className={`badge ${STATUS[status]?.[1] || ''}`}>{STATUS[status]?.[0] || status}</span>;

function MyPhotos() {
  const { data, loading } = useApi('/my/photos');
  if (loading) return <Loading />;
  const photos = data?.photos || [];
  if (!photos.length) {
    return <Empty icon={Images} title="Nenhuma foto adquirida ainda"><Link to="/encontradas" className="btn btn-accent">Ver fotos encontradas para você</Link></Empty>;
  }
  const owned = new Set(photos.map((p) => p.id));
  const groups = [];
  for (const p of photos) {
    let g = groups.find((x) => x.slug === p.event_slug);
    if (!g) groups.push((g = { slug: p.event_slug, title: p.event_title, date: p.event_date, photos: [] }));
    g.photos.push(p);
  }
  return (
    <div className="stack" style={{ gap: 30 }}>
      <div className="row between card-flat" style={{ padding: 14 }}>
        <span className="small">{photos.length} fotos em alta resolução. Toque numa foto para ampliar e baixar.</span>
        <a className="btn btn-sm btn-accent" href={`/api/download-zip?ids=${photos.map((p) => p.id).join(',')}`}><Download size={15} /> Baixar todas</a>
      </div>
      {groups.map((g) => (
        <section key={g.slug} className="stack" style={{ gap: 10 }}>
          <div className="row between">
            <div><h3>{g.title}</h3><span className="small muted">{dateBR(g.date)}</span></div>
            <a className="btn btn-sm btn-ghost" href={`/api/download-zip?ids=${g.photos.map((p) => p.id).join(',')}`}><Download size={14} /> Baixar evento</a>
          </div>
          <PhotoGrid photos={g.photos} rowHeight={170} owned={owned} />
        </section>
      ))}
    </div>
  );
}

function MyOrders() {
  const { data, loading } = useApi('/my/orders');
  if (loading) return <Loading />;
  if (!data?.orders?.length) return <Empty icon={Receipt} title="Nenhum pedido ainda" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Pedido</th><th>Data</th><th>Fotos</th><th>Status</th><th className="num">Total</th></tr></thead>
        <tbody>
          {data.orders.map((o) => (
            <tr key={o.code}>
              <td><Link to={`/pedido/${o.code}`} style={{ textDecoration: 'underline' }}>{o.code}</Link></td>
              <td>{dateTimeBR(o.created_at)}</td>
              <td>{o.items}</td>
              <td><StatusBadge status={o.status} /></td>
              <td className="num">{money(o.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MyAccount() {
  const { user, refresh, toast } = useSite();
  const [f, setF] = useState({ name: user.name, phone: user.phone || '', current_password: '', password: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/auth/me', { method: 'PUT', body: f });
      await refresh();
      setF({ ...f, current_password: '', password: '' });
      toast('Dados salvos');
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="card stack" style={{ maxWidth: 520 }} onSubmit={save}>
      <label className="field"><span>Nome</span><input className="input" value={f.name} onChange={set('name')} /></label>
      <label className="field"><span>E-mail</span><input className="input" value={user.email} disabled /></label>
      <label className="field"><span>WhatsApp</span><input className="input" value={f.phone} onChange={set('phone')} /></label>
      <b style={{ marginTop: 8 }}>Trocar senha</b>
      <div className="grid-2">
        <label className="field"><span>Senha atual</span><input className="input" type="password" value={f.current_password} onChange={set('current_password')} /></label>
        <label className="field"><span>Nova senha</span><input className="input" type="password" value={f.password} onChange={set('password')} minLength={6} /></label>
      </div>
      {error && <div className="alert alert-bad">{error}</div>}
      <button className="btn" style={{ alignSelf: 'flex-start' }}>Salvar</button>
    </form>
  );
}

export default function Account({ tab }) {
  const { user, ready } = useSite();
  const nav = useNavigate();
  useTitle({ fotos: 'Fotos adquiridas', encontradas: 'Encontradas para você', rosto: 'Meu rosto e privacidade', pedidos: 'Meus pedidos' }[tab] || 'Minha conta');
  if (!ready) return <Loading />;
  if (!user) {
    return (
      <div className="container"><div className="auth-wrap card stack" style={{ padding: 28 }}>
        <h2>Entre para ver suas fotos</h2><AuthForm />
      </div></div>
    );
  }
  return (
    <div className="container section-sm stack" style={{ gap: 22 }}>
      <h1 style={{ fontSize: 'clamp(28px,4vw,40px)' }}>Olá, {user.name.split(' ')[0]}</h1>
      <div className="tabs">
        <button className={tab === 'encontradas' ? 'active' : ''} onClick={() => nav('/encontradas')}>Encontradas para você{user.matches_new > 0 && <> <span className="dot-new">{user.matches_new}</span></>}</button>
        <button className={tab === 'fotos' ? 'active' : ''} onClick={() => nav('/minhas-fotos')}>Adquiridas</button>
        <button className={tab === 'rosto' ? 'active' : ''} onClick={() => nav('/meu-rosto')}>Meu rosto e privacidade</button>
        <button className={tab === 'pedidos' ? 'active' : ''} onClick={() => nav('/meus-pedidos')}>Pedidos</button>
        <button className={tab === 'conta' ? 'active' : ''} onClick={() => nav('/conta')}>Meus dados</button>
      </div>
      {tab === 'encontradas' && <MatchedPhotos />}
      {tab === 'rosto' && <FacePrivacy />}
      {tab === 'fotos' && <MyPhotos />}
      {tab === 'pedidos' && <MyOrders />}
      {tab === 'conta' && <MyAccount />}
    </div>
  );
}
