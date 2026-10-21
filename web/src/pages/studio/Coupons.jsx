import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useApi, useSite } from '../../lib/site.jsx';
import { dateBR } from '../../lib/format.js';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import { PageHead } from './Studio.jsx';

export default function Coupons() {
  const { toast } = useSite();
  const { data, loading, error, reload } = useApi('/studio/coupons');
  const events = useApi('/studio/events');
  const [f, setF] = useState({ code: '', pct: 10, event_id: '', max_uses: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const create = async (e) => {
    e.preventDefault();
    try {
      await api('/studio/coupons', { method: 'POST', body: f });
      toast('Cupom criado');
      setF({ code: '', pct: 10, event_id: '', max_uses: '' });
      reload();
    } catch (err) {
      toast(err.message);
    }
  };
  const toggle = async (c) => {
    await api(`/studio/coupons/${c.id}`, { method: 'PUT', body: { active: !c.active } });
    reload();
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead title="Cupons de desconto" />
      <form className="card stack" onSubmit={create}>
        <p className="small muted">Crie cupons para divulgar no Instagram, mandar para formandos ou recuperar clientes. Vale só para os seus eventos.</p>
        <div className="grid-3" style={{ gridTemplateColumns: '1fr 120px 1fr 120px' }}>
          <label className="field"><span>Código</span><input className="input" required value={f.code} onChange={set('code')} placeholder="FORMATURA10" style={{ textTransform: 'uppercase' }} /></label>
          <label className="field"><span>% off</span><input className="input" type="number" min="1" max="100" required value={f.pct} onChange={set('pct')} /></label>
          <label className="field"><span>Evento</span>
            <select className="select" value={f.event_id} onChange={set('event_id')}>
              <option value="">Todos os meus eventos</option>
              {(events.data?.events || []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </label>
          <label className="field"><span>Limite de usos</span><input className="input" type="number" min="1" value={f.max_uses} onChange={set('max_uses')} placeholder="∞" /></label>
        </div>
        <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }}>Criar cupom</button>
      </form>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : data.coupons.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Código</th><th>Desconto</th><th>Evento</th><th className="num">Usos</th><th>Criado</th><th></th></tr></thead>
          <tbody>{data.coupons.map((c) => (
            <tr key={c.id} style={{ opacity: c.active ? 1 : 0.5 }}>
              <td><b>{c.code}</b></td><td>{c.pct}%</td><td className="small">{c.event_title || 'Todos'}</td>
              <td className="num">{c.uses}{c.max_uses ? ` / ${c.max_uses}` : ''}</td><td className="small">{dateBR(c.created_at)}</td>
              <td><button className="btn btn-sm btn-ghost" onClick={() => toggle(c)}>{c.active ? 'Desativar' : 'Ativar'}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
