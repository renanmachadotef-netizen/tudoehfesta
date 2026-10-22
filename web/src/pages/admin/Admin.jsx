import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { LayoutDashboard, Users, Receipt, Wallet, FolderOpen, Tag, Settings, UserCog, Camera, Stamp, Activity } from 'lucide-react';
import { api, uploadWithProgress } from '../../lib/api.js';
import { useApi, useSite, useTitle } from '../../lib/site.jsx';
import { money, dateTimeBR, dateBR, compact, centsToInput } from '../../lib/format.js';
import { Loading, ErrorBox, Empty } from '../../components/Layout.jsx';
import { Bars, PageHead } from '../studio/Studio.jsx';
import WatermarkEditor from '../../components/WatermarkEditor.jsx';
import { StatusBadge } from '../Account.jsx';
import { EVENT_STATUS } from '../studio/EventsList.jsx';
import DisplaySelect from '../../components/DisplaySelect.jsx';
import Live from './Live.jsx';

function Dashboard() {
  const { data, loading, error } = useApi('/admin/dashboard');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { totals: t, series, pending: p, topPhotographers, mercadopago } = data;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead title="Administração" />
      {!mercadopago && (
        <div className="alert alert-warn">Mercado Pago não configurado: o site está em <b>Pix manual</b> (você confirma cada pedido em Pedidos). Configure <code>MP_ACCESS_TOKEN</code> no Easypanel para Pix automático e cartão.</div>
      )}
      {(p.photographers > 0 || p.payouts > 0 || p.manual_orders > 0) && (
        <div className="row">
          {p.photographers > 0 && <Link to="/admin/fotografos" className="badge badge-warn" style={{ height: 32, padding: '0 14px' }}>{p.photographers} fotógrafo(s) aguardando aprovação</Link>}
          {p.payouts > 0 && <Link to="/admin/saques" className="badge badge-warn" style={{ height: 32, padding: '0 14px' }}>{p.payouts} saque(s) para pagar · {money(p.payouts_cents)}</Link>}
          {p.manual_orders > 0 && <Link to="/admin/pedidos?status=pending" className="badge badge-warn" style={{ height: 32, padding: '0 14px' }}>{p.manual_orders} Pix manual para conferir</Link>}
        </div>
      )}
      <div className="kpis">
        <div className="kpi accent"><span>Vendas do mês</span><b>{money(t.gmv_month)}</b><small>{t.orders_month} pedidos</small></div>
        <div className="kpi"><span>Comissão do mês</span><b>{money(t.commission_month)}</b><small>receita da plataforma</small></div>
        <div className="kpi"><span>Vendas totais</span><b>{money(t.gmv_total)}</b><small>comissão total {money(t.commission_total)}</small></div>
        <div className="kpi"><span>Pedidos pendentes (48h)</span><b>{t.orders_pending}</b></div>
      </div>
      <div className="card stack"><h3>Vendas dos últimos 30 dias</h3><Bars series={series} format={money} /></div>
      <div className="kpis">
        <div className="kpi"><span>Eventos publicados</span><b>{t.events}</b></div>
        <div className="kpi"><span>Fotos</span><b>{compact(t.photos)}</b></div>
        <div className="kpi"><span>Rostos indexados</span><b>{compact(t.faces)}</b></div>
        <div className="kpi"><span>Clientes</span><b>{compact(t.customers)}</b></div>
      </div>
      {topPhotographers.length > 0 && (
        <div className="stack"><h3>Fotógrafos que mais venderam no mês</h3>
          <div className="table-wrap"><table className="table"><tbody>{topPhotographers.map((x) => (
            <tr key={x.slug}><td>{x.display_name}</td><td className="num">{x.photos} fotos</td><td className="num">{money(x.gross_cents)}</td></tr>
          ))}</tbody></table></div>
        </div>
      )}
    </div>
  );
}

function Photographers() {
  const { toast } = useSite();
  const { data, loading, error, reload } = useApi('/admin/photographers');
  const update = async (p, body) => {
    try {
      await api(`/admin/photographers/${p.user_id}`, { method: 'PUT', body: { status: p.status, commission_pct: p.commission_pct ?? '', ...body } });
      toast('Atualizado');
      reload();
    } catch (err) { toast(err.message); }
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="stack">
      <PageHead title="Fotógrafos" />
      {!data.photographers.length ? <Empty title="Nenhum fotógrafo cadastrado" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Fotógrafo</th><th>Contato</th><th>Status</th><th className="num">Eventos/fotos</th><th className="num">Vendido</th><th className="num">Saldo</th><th>Comissão</th><th></th></tr></thead>
          <tbody>{data.photographers.map((p) => (
            <tr key={p.user_id}>
              <td><b>{p.display_name}</b><div className="tiny muted">{p.city} {p.camera && `· ${p.camera}`}</div>{p.bio && <div className="tiny muted" style={{ maxWidth: 260 }}>{p.bio}</div>}</td>
              <td className="small">{p.email}<div>{p.whatsapp || p.phone}</div>{p.instagram && <a href={`https://instagram.com/${p.instagram}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>@{p.instagram}</a>}</td>
              <td><span className={`badge ${p.status === 'approved' ? 'badge-ok' : p.status === 'pending' ? 'badge-warn' : 'badge-bad'}`}>{{ approved: 'Aprovado', pending: 'Em análise', blocked: 'Bloqueado' }[p.status]}</span></td>
              <td className="num">{p.events} / {p.photos}</td>
              <td className="num">{money(p.gross_cents)}</td>
              <td className="num">{money(p.balance.available)}</td>
              <td><input className="input" style={{ width: 80, height: 34 }} placeholder="padrão" defaultValue={p.commission_pct ?? ''} onBlur={(e) => e.target.value !== String(p.commission_pct ?? '') && update(p, { commission_pct: e.target.value })} /></td>
              <td><div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                {p.status !== 'approved' && <button className="btn btn-sm btn-accent" onClick={() => update(p, { status: 'approved' })}>Aprovar</button>}
                {p.status !== 'blocked' && <button className="btn btn-sm btn-ghost" onClick={() => confirm('Bloquear e ocultar os eventos deste fotógrafo?') && update(p, { status: 'blocked' })}>Bloquear</button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Orders() {
  const { toast } = useSite();
  const [status, setStatus] = useState(new URLSearchParams(window.location.search).get('status') || '');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, error, reload } = useApi(`/admin/orders?status=${status}&q=${encodeURIComponent(query)}`);
  const act = async (o, action, body) => {
    try {
      await api(`/admin/orders/${o.id}/${action}`, { method: 'POST', body });
      toast('Pedido atualizado');
      reload();
    } catch (err) { toast(err.message); }
  };
  return (
    <div className="stack">
      <PageHead title="Pedidos">
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
          <input className="input" style={{ height: 38, width: 220 }} placeholder="Código, nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ height: 38, width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option><option value="pending">Pendentes</option><option value="paid">Pagos</option><option value="cancelled">Cancelados</option><option value="refunded">Estornados</option>
          </select>
        </form>
      </PageHead>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.orders.length ? <Empty title="Nenhum pedido" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Pagamento</th><th>Status</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{data.orders.map((o) => (
            <tr key={o.id}>
              <td><Link to={`/pedido/${o.code}`} style={{ textDecoration: 'underline' }}>{o.code}</Link><div className="tiny muted">{o.items} fotos{o.coupon_code && ` · ${o.coupon_code}`}</div></td>
              <td className="small"><b>{o.buyer}</b><div>{o.email}</div>{o.phone && <a href={`https://wa.me/55${o.phone.replace(/\D/g, '').replace(/^55/, '')}`} target="_blank" rel="noreferrer">{o.phone}</a>}</td>
              <td className="small">{dateTimeBR(o.created_at)}</td>
              <td className="small">{{ pix: 'Pix', cartao: 'Cartão', pix_manual: 'Pix manual' }[o.payment_method] || o.payment_method}
                {o.payment_provider && o.payment_provider !== 'manual' && <div className="tiny muted">{o.payment_provider === 'infinitepay' ? 'InfinitePay' : 'Mercado Pago'}{o.installments > 1 ? ` · ${o.installments}x` : ''}</div>}
                {o.ip_receipt_url && <a className="tiny" href={o.ip_receipt_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>comprovante</a>}
              </td>
              <td><StatusBadge status={o.status} /></td>
              <td className="num">{money(o.total_cents)}</td>
              <td><div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                {o.status === 'pending' && <button className="btn btn-sm btn-accent" onClick={() => confirm(`Confirmar o recebimento de ${money(o.total_cents)}?`) && act(o, 'mark-paid')}>Marcar pago</button>}
                {o.status === 'pending' && <button className="btn btn-sm btn-ghost" onClick={() => act(o, 'cancel')}>Cancelar</button>}
                {o.status === 'paid' && <button className="btn btn-sm btn-ghost" onClick={() => confirm('Marcar como estornado? O cliente perde o acesso às fotos e o valor sai do saldo do fotógrafo.') && act(o, 'cancel', { refund: true })}>Estornar</button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Payouts() {
  const { toast } = useSite();
  const { data, loading, error, reload } = useApi('/admin/payouts');
  const act = async (p, action) => {
    const note = action === 'reject' ? prompt('Motivo (aparece para o fotógrafo):') : null;
    if (action === 'reject' && note === null) return;
    await api(`/admin/payouts/${p.id}/${action}`, { method: 'POST', body: { note } });
    toast(action === 'pay' ? 'Saque marcado como pago' : 'Saque recusado');
    reload();
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="stack">
      <PageHead title="Saques dos fotógrafos" />
      <p className="small muted">Faça o Pix pelo app do banco para a chave indicada e depois clique em “Marquei como pago”.</p>
      {!data.payouts.length ? <Empty title="Nenhum saque solicitado" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Fotógrafo</th><th>Chave Pix</th><th>Pedido em</th><th>Status</th><th className="num">Valor</th><th></th></tr></thead>
          <tbody>{data.payouts.map((p) => (
            <tr key={p.id}>
              <td><b>{p.display_name}</b><div className="tiny muted">{p.email}</div></td>
              <td className="small"><b>{p.pix_key}</b><div className="tiny muted">{p.pix_key_type}</div></td>
              <td className="small">{dateTimeBR(p.requested_at)}</td>
              <td><span className={`badge ${p.status === 'paid' ? 'badge-ok' : p.status === 'requested' ? 'badge-warn' : 'badge-bad'}`}>{{ paid: 'Pago', requested: 'Aguardando', rejected: 'Recusado' }[p.status]}</span></td>
              <td className="num"><b>{money(p.amount_cents)}</b></td>
              <td>{p.status === 'requested' && <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                <button className="btn btn-sm btn-accent" onClick={() => act(p, 'pay')}>Marquei como pago</button>
                <button className="btn btn-sm btn-ghost" onClick={() => act(p, 'reject')}>Recusar</button>
              </div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function Events() {
  const { toast } = useSite();
  const { data, loading, error, reload } = useApi('/admin/events');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const purge = async (e) => {
    const typed = prompt(`Excluir DEFINITIVAMENTE "${e.title}", com todas as fotos e os pedidos dele? Isso não pode ser desfeito.\nAs fotos continuam no Google Drive e não voltam na próxima sincronização.\n\nDigite o nome do evento para confirmar:`);
    if (typed == null) return;
    try {
      const d = await api(`/admin/events/${e.id}/purge`, { method: 'POST', body: { confirm: typed } });
      toast(`Excluído: ${d.photos} fotos e ${d.orders} pedidos`);
      reload();
    } catch (err) { toast(err.message); }
  };
  const setStatus = async (e, status) => {
    await api(`/admin/events/${e.id}/status`, { method: 'PUT', body: { status } });
    toast('Status alterado');
    reload();
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const ym = (e) => String(e.event_date).slice(0, 7);
  const years = [...new Set(data.events.map((e) => String(e.event_date).slice(0, 4)))].sort().reverse();
  const months = [...new Set(data.events.filter((e) => !year || String(e.event_date).startsWith(year)).map((e) => Number(String(e.event_date).slice(5, 7))))].sort((a, b) => a - b);
  const text = q.trim().toLowerCase();
  const list = data.events.filter((e) => (!year || String(e.event_date).startsWith(year))
    && (!month || Number(String(e.event_date).slice(5, 7)) === Number(month))
    && (kind === 'all' || e.kind === kind)
    && (!text || e.title.toLowerCase().includes(text)));
  const groups = [];
  for (const e of list) {
    const k = ym(e);
    let g = groups[groups.length - 1];
    if (!g || g.key !== k) groups.push((g = { key: k, items: [] }));
    g.items.push(e);
  }
  const label = (k) => { const m = MONTH_NAMES[Number(k.slice(5, 7)) - 1]; return `${m[0].toUpperCase()}${m.slice(1)} de ${k.slice(0, 4)}`; };
  return (
    <div className="stack">
      <PageHead title="Todos os eventos"><Link to="/painel/acervo" className="btn btn-sm btn-ghost">Ver acervo por ano</Link><Link to="/painel/eventos/novo" className="btn btn-sm btn-accent">Novo evento (meu)</Link></PageHead>
      <div className="stack" style={{ gap: 10 }}>
        <div className="chips">
          <button className={`chip${!year ? ' active' : ''}`} onClick={() => { setYear(''); setMonth(''); }}>Todos os anos <em>{data.events.length}</em></button>
          {years.map((y) => (
            <button key={y} className={`chip${year === y ? ' active' : ''}`} onClick={() => { setYear(y); setMonth(''); }}>
              {y} <em>{data.events.filter((e) => String(e.event_date).startsWith(y)).length}</em>
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select className="select" style={{ height: 36, width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">Todos os meses</option>
            {months.map((m) => <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>)}
          </select>
          <select className="select" style={{ height: 36, width: 190 }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">Acervo e eventos</option>
            <option value="pool">Só pastas do acervo</option>
            <option value="event">Só eventos cadastrados</option>
          </select>
          <input className="input" style={{ height: 36, width: 220 }} placeholder="Buscar pelo nome" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="small muted">{list.length} de {data.events.length}</span>
        </div>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Evento</th><th>Fotógrafo</th><th>Exibição no site</th><th>Status</th><th className="num">Fotos</th><th className="num">Rostos</th><th className="num">Visitas</th><th className="num">Vendido</th><th></th></tr></thead>
        <tbody>{groups.map((g) => [
          <tr key={g.key} className="group-row"><td colSpan={9}><b>{label(g.key)}</b> <span className="muted small">· {g.items.length} {g.items.length === 1 ? 'pasta/evento' : 'pastas/eventos'} · {g.items.reduce((n, e) => n + e.photo_count, 0).toLocaleString('pt-BR')} fotos</span></td></tr>,
          ...g.items.map((e) => (
          <tr key={e.id}>
            <td><Link to={`/painel/eventos/${e.id}`} style={{ fontWeight: 600 }}>{e.title}</Link><div className="tiny muted">{dateBR(e.event_date)} · {e.kind === 'pool' ? 'acervo do ano' : e.category_name || 'sem categoria'}</div></td>
            <td className="small">{e.photographer_name}</td>
            <td><DisplaySelect event={e} small onChanged={reload} /></td>
            <td><select className="select" style={{ height: 32, width: 130, fontSize: 13 }} value={e.status} onChange={(ev) => setStatus(e, ev.target.value)}>
              {Object.entries(EVENT_STATUS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select></td>
            <td className="num">{e.photo_count}</td><td className="num">{e.face_count}</td><td className="num">{e.views}</td><td className="num">{money(e.gross_cents)}</td>
            <td><button className="btn btn-sm btn-danger" onClick={() => purge(e)}>Excluir</button></td>
          </tr>
          )),
        ])}</tbody>
      </table></div>
    </div>
  );
}

function Categories() {
  const { refresh, toast } = useSite();
  const { data, loading, reload } = useApi('/admin/categories');
  const [name, setName] = useState('');
  const add = async (e) => {
    e.preventDefault();
    await api('/admin/categories', { method: 'POST', body: { name } });
    setName('');
    reload();
    refresh();
  };
  const save = async (c, body) => {
    await api(`/admin/categories/${c.id}`, { method: 'PUT', body });
    reload();
    refresh();
  };
  const del = async (c) => {
    if (!confirm(`Excluir "${c.name}"? Os eventos ficam sem categoria.`)) return;
    await api(`/admin/categories/${c.id}`, { method: 'DELETE' });
    toast('Categoria excluída');
    reload();
    refresh();
  };
  if (loading) return <Loading />;
  return (
    <div className="stack" style={{ maxWidth: 680 }}>
      <PageHead title="Categorias" />
      <form className="row" onSubmit={add}><input className="input grow" required placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn btn-accent">Adicionar</button></form>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Ordem</th><th>Nome</th><th className="num">Eventos</th><th></th></tr></thead>
        <tbody>{data.categories.map((c) => (
          <tr key={c.id}>
            <td><input className="input" type="number" style={{ width: 70, height: 34 }} defaultValue={c.sort} onBlur={(e) => Number(e.target.value) !== c.sort && save(c, { sort: e.target.value })} /></td>
            <td><input className="input" style={{ height: 34 }} defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && save(c, { name: e.target.value })} /></td>
            <td className="num">{c.events}</td>
            <td><button className="btn btn-sm btn-ghost" onClick={() => del(c)}>Excluir</button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

function WatermarkPage() {
  const { toast } = useSite();
  const { data, loading, reload } = useApi('/admin/watermark');
  const sys = useApi('/admin/system');
  const [saving, setSaving] = useState(false);
  if (loading) return <Loading />;
  const save = async (wm) => {
    setSaving(true);
    try {
      const d = await api('/admin/watermark', { method: 'PUT', body: { watermark: wm } });
      toast(d.rerender ? `Marca salva. Refazendo ${d.rerender} vitrines em segundo plano…` : 'Marca salva');
      reload();
      sys.reload();
    } finally {
      setSaving(false);
    }
  };
  const q = sys.data?.queue;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Marca d’água padrão" />
      <p className="small muted">Vale para todos os eventos marcados como “Padrão do site” (e para fotógrafos que ainda não cadastraram a própria marca). Cada evento também pode sair sem marca.</p>
      {q && (q.render > 0 || q.faces > 0) && <div className="alert alert-warn">Fila do servidor: {q.render} vitrine(s) para refazer · {q.faces} foto(s) procurando rostos.</div>}
      <div className="card"><WatermarkEditor base="/admin" value={data.watermark} saving={saving} onSave={save} /></div>
    </div>
  );
}

function UserRow({ u, onChanged }) {
  const { toast, user: me } = useSite();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: u.name, email: u.email, phone: u.phone || '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const reset = async () => {
    if (!confirm(`Gerar senha provisória para ${u.email}?`)) return;
    const d = await api(`/admin/users/${u.id}/reset-password`, { method: 'POST' });
    prompt('Senha provisória (envie ao cliente pelo WhatsApp):', d.password);
  };
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(`/admin/users/${u.id}`, { method: 'PUT', body: f });
      toast('Cadastro corrigido');
      setEditing(false);
      onChanged();
    } catch (err) { toast(err.message); }
  };
  const remove = async () => {
    if (!confirm(`Excluir a conta de ${u.name} (${u.email})?\n\nSai junto: rosto cadastrado, fotos encontradas e pedidos não pagos. Isso não pode ser desfeito.`)) return;
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      toast('Usuário excluído');
      onChanged();
    } catch (err) { toast(err.message); }
  };
  if (editing) {
    return (
      <tr><td colSpan={6}>
        <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={save}>
          <input className="input" style={{ height: 36, width: 200 }} value={f.name} onChange={set('name')} placeholder="Nome" required />
          <input className="input" style={{ height: 36, width: 240 }} type="email" value={f.email} onChange={set('email')} placeholder="E-mail" required />
          <input className="input" style={{ height: 36, width: 160 }} value={f.phone} onChange={set('phone')} placeholder="WhatsApp" />
          <button className="btn btn-sm btn-accent">Salvar</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditing(false); setF({ name: u.name, email: u.email, phone: u.phone || '' }); }}>Cancelar</button>
        </form>
      </td></tr>
    );
  }
  return (
    <tr><td>{u.name}</td><td className="small">{u.email}<div>{u.phone}</div></td>
      <td><span className="badge">{{ customer: 'Cliente', photographer: 'Fotógrafo', admin: 'Admin' }[u.role]}</span></td>
      <td className="num">{u.orders}</td><td className="small">{dateBR(u.created_at)}</td>
      <td><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>Editar</button>
        <button className="btn btn-sm btn-ghost" onClick={reset}>Nova senha</button>
        {u.role !== 'admin' && u.id !== me?.id && <button className="btn btn-sm btn-danger" onClick={remove}>Excluir</button>}
      </div></td></tr>
  );
}

function UsersPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, reload } = useApi(`/admin/users?q=${encodeURIComponent(query)}`);
  return (
    <div className="stack">
      <PageHead title="Usuários">
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}><input className="input" style={{ height: 38, width: 240 }} placeholder="Nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} /></form>
      </PageHead>
      {loading ? <Loading /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Tipo</th><th className="num">Compras</th><th>Desde</th><th></th></tr></thead>
          <tbody>{data.users.map((u) => <UserRow key={u.id} u={u} onChanged={reload} />)}</tbody>
        </table></div>
      )}
    </div>
  );
}

function DriveStatus() {
  const { data } = useApi('/admin/system');
  if (!data) return null;
  const d = data.drive;
  return (
    <div className="card stack">
      <h3>Google Drive</h3>
      {d.configured ? (
        <div className="alert alert-ok">Ativo ({d.mode === 'service_account' ? 'conta de serviço' : 'chave de API'}), verificando as pastas a cada {d.sync_minutes} min.{d.share_with && <> Os fotógrafos compartilham as pastas com <b style={{ userSelect: 'all' }}>{d.share_with}</b>.</>}</div>
      ) : (
        <div className="alert alert-warn">Não configurado. No Easypanel (site → Environment), adicione <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> (recomendado: pastas ficam privadas) ou <code>GOOGLE_API_KEY</code> (pastas precisam estar públicas por link).</div>
      )}
    </div>
  );
}

function SettingsPage() {
  const { refresh, toast } = useSite();
  const { data, loading, reload } = useApi('/admin/settings');
  const [f, setF] = useState(null);
  if (loading) return <Loading />;
  const s = data.settings;
  const form = f || { commission_pct: s.commission_pct, release_days: s.release_days, min_payout: centsToInput(s.min_payout_cents), ...s.site, pay_pix: data.payments.pix, pay_card: data.payments.card || '' };
  const set = (k) => (e) => setF({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    await api('/admin/settings', {
      method: 'PUT',
      body: {
        commission_pct: form.commission_pct, release_days: form.release_days,
        min_payout_cents: Math.round(Number(String(form.min_payout).replace(',', '.')) * 100),
        payments: { pix: form.pay_pix, card: form.pay_card },
        site: { whatsapp: form.whatsapp, instagram: form.instagram, tagline: form.tagline, about: form.about, pix_key: form.pix_key, pix_name: form.pix_name, since: form.since },
      },
    });
    toast('Configurações salvas');
    reload();
    refresh();
  };
  const upload = async (kind, file) => {
    const fd = new FormData();
    fd.append('file', file);
    await uploadWithProgress(`/admin/settings/${kind}`, fd);
    toast('Imagem atualizada');
    reload();
    refresh();
  };
  return (
    <form className="stack" style={{ maxWidth: 760, gap: 18 }} onSubmit={save}>
      <PageHead title="Configurações" />
      <div className="card stack">
        <h3>Comissão e repasses</h3>
        <div className="grid-3">
          <label className="field"><span>Comissão padrão (%)</span><input className="input" type="number" min="0" max="100" step="0.5" value={form.commission_pct} onChange={set('commission_pct')} /><small>Pode ser ajustada por fotógrafo.</small></label>
          <label className="field"><span>Dias para liberar saldo</span><input className="input" type="number" min="0" max="60" value={form.release_days} onChange={set('release_days')} /></label>
          <label className="field"><span>Saque mínimo (R$)</span><input className="input" value={form.min_payout} onChange={set('min_payout')} /></label>
        </div>
      </div>
      <div className="card stack">
        <h3>Pagamentos</h3>
        <div className="row small">
          <span className={`badge ${data.payments.mercadopago ? 'badge-ok' : ''}`}>Mercado Pago {data.payments.mercadopago ? 'ativo' : 'não configurado'}</span>
          <span className={`badge ${data.payments.infinitepay ? 'badge-ok' : ''}`}>InfinitePay {data.payments.infinitepay ? 'ativa' : 'não configurada'}</span>
        </div>
        {!data.payments.mercadopago && !data.payments.infinitepay && (
          <div className="alert alert-warn">Nenhum serviço de pagamento automático ativo: o cliente vê a chave Pix abaixo e você confirma o pedido em Pedidos. Ative no Easypanel com <code>MP_ACCESS_TOKEN</code> e/ou <code>INFINITEPAY_HANDLE</code>.</div>
        )}
        {data.payments.mercadopago && data.payments.infinitepay && (
          <div className="grid-2">
            <label className="field"><span>Pix pelo</span>
              <select className="select" value={form.pay_pix} onChange={set('pay_pix')}>
                <option value="mercadopago">Mercado Pago (QR Code na própria página)</option>
                <option value="infinitepay">InfinitePay (página da InfinitePay)</option>
              </select>
            </label>
            <label className="field"><span>Cartão pelo</span>
              <select className="select" value={form.pay_card} onChange={set('pay_card')}>
                <option value="infinitepay">InfinitePay</option>
                <option value="mercadopago">Mercado Pago</option>
              </select>
            </label>
          </div>
        )}
        <div className="grid-2">
          <label className="field"><span>Chave Pix (modo manual)</span><input className="input" value={form.pix_key || ''} onChange={set('pix_key')} /></label>
          <label className="field"><span>Nome do recebedor</span><input className="input" value={form.pix_name || ''} onChange={set('pix_name')} /></label>
        </div>
      </div>
      <div className="card stack">
        <h3>Site</h3>
        <div className="grid-2">
          <label className="field"><span>WhatsApp (com DDI e DDD)</span><input className="input" value={form.whatsapp || ''} onChange={set('whatsapp')} placeholder="5548999999999" /></label>
          <label className="field"><span>Instagram</span><input className="input" value={form.instagram || ''} onChange={set('instagram')} /></label>
          <label className="field"><span>Frase</span><input className="input" value={form.tagline || ''} onChange={set('tagline')} /></label>
          <label className="field"><span>Desde (ano)</span><input className="input" type="number" value={form.since || ''} onChange={set('since')} /></label>
        </div>
        <div className="row">
          <label className="btn btn-soft btn-sm"><Camera size={14} /> Enviar logo<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && upload('logo', e.target.files[0])} /></label>
          {s.site?.logo && <img src={s.site.logo} alt="logo" style={{ height: 36, background: 'var(--surface)', borderRadius: 6, padding: 4 }} />}
        </div>
      </div>
      <DriveStatus />
      <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }}>Salvar configurações</button>
    </form>
  );
}

export default function Admin() {
  const { user, ready } = useSite();
  useTitle('Administração');
  if (!ready) return <Loading />;
  if (user?.role !== 'admin') return <Navigate to="/entrar?voltar=/admin" replace />;
  return (
    <div className="panel">
      <aside className="panel-side">
        <div className="side-title">Administração</div>
        <NavLink to="/admin" end><LayoutDashboard size={18} /> Visão geral</NavLink>
        <NavLink to="/admin/ao-vivo"><Activity size={18} /> Ao vivo</NavLink>
        <NavLink to="/admin/pedidos"><Receipt size={18} /> Pedidos</NavLink>
        <NavLink to="/admin/fotografos"><Users size={18} /> Fotógrafos</NavLink>
        <NavLink to="/admin/saques"><Wallet size={18} /> Saques</NavLink>
        <NavLink to="/admin/eventos"><FolderOpen size={18} /> Eventos</NavLink>
        <NavLink to="/admin/categorias"><Tag size={18} /> Categorias</NavLink>
        <NavLink to="/admin/marca-dagua"><Stamp size={18} /> Marca d’água</NavLink>
        <NavLink to="/admin/usuarios"><UserCog size={18} /> Usuários</NavLink>
        <NavLink to="/admin/config"><Settings size={18} /> Configurações</NavLink>
        <div className="side-title">Meu estúdio</div>
        <NavLink to="/painel"><Camera size={18} /> Painel do fotógrafo</NavLink>
      </aside>
      <section className="panel-main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="ao-vivo" element={<Live />} />
          <Route path="pedidos" element={<Orders />} />
          <Route path="fotografos" element={<Photographers />} />
          <Route path="saques" element={<Payouts />} />
          <Route path="eventos" element={<Events />} />
          <Route path="categorias" element={<Categories />} />
          <Route path="marca-dagua" element={<WatermarkPage />} />
          <Route path="usuarios" element={<UsersPage />} />
          <Route path="config" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </section>
    </div>
  );
}
