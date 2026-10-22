import { useState } from 'react';
import { Users, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi, useSite } from '../../lib/site.jsx';
import { money, dateTimeBR } from '../../lib/format.js';

const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 16) : '');

// Equipe do evento: fotografos convidados enviam as proprias fotos; o organizador define a parte dele
// sobre as vendas dessas fotos, o limite de fotos e o prazo de envio de cada um.
export default function EventTeam({ eventId }) {
  const { toast } = useSite();
  const { data, reload } = useApi(`/studio/events/${eventId}/team`);
  const [f, setF] = useState({ email: '', max_photos: '', upload_until: '' });
  const [pct, setPct] = useState(null);
  if (!data) return null;
  const orgPct = pct ?? data.organizer_pct;
  const add = async (e) => {
    e.preventDefault();
    try {
      await api(`/studio/events/${eventId}/team`, { method: 'POST', body: f });
      toast('Fotógrafo adicionado à equipe');
      setF({ email: '', max_photos: '', upload_until: '' });
      reload();
    } catch (err) { toast(err.message); }
  };
  const savePct = async () => {
    try {
      const d = await api(`/studio/events/${eventId}/organizer`, { method: 'PUT', body: { organizer_pct: orgPct } });
      setPct(d.organizer_pct);
      toast('Sua parte como organizador foi salva');
      reload();
    } catch (err) { toast(err.message); }
  };
  const update = async (m, k, v) => {
    const body = { max_photos: m.max_photos || '', upload_until: toLocalInput(m.upload_until), [k]: v };
    await api(`/studio/events/${eventId}/team/${m.id}`, { method: 'PUT', body });
    reload();
  };
  const remove = async (m) => {
    if (!confirm(`Tirar ${m.display_name || m.name} da equipe? As fotos que essa pessoa já enviou continuam no evento.`)) return;
    await api(`/studio/events/${eventId}/team/${m.id}`, { method: 'DELETE' });
    reload();
  };
  const rows = [{ ...data.owner, owner: true }, ...data.members].sort((a, b) => b.cents - a.cents);

  return (
    <div className="card stack" style={{ gap: 14 }}>
      <h3 className="row" style={{ gap: 8 }}><Users size={18} /> Equipe de fotógrafos</h3>
      <p className="small muted">Convide outros fotógrafos para cobrir o evento com você. Cada um envia as próprias fotos pelo painel dele e recebe pelas fotos dele que venderem; você fica com a sua parte de organizador sobre essas vendas.</p>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="field" style={{ maxWidth: 260 }}><span>Sua parte sobre as fotos da equipe (%)</span>
          <input className="input" type="number" min="0" max="50" value={orgPct} onChange={(e) => setPct(e.target.value)} />
        </label>
        <button className="btn btn-sm btn-soft" onClick={savePct}>Salvar</button>
        <span className="small muted">Ex.: foto de R$ 20 com 10% → você R$ 2,00; o resto, tirando a comissão do site, vai para o fotógrafo. Já recebido como organizador: <b>{money(data.organizer_cents)}</b>.</span>
      </div>

      <div className="table-wrap"><table className="table">
        <thead><tr><th>Fotógrafo</th><th className="num">Fotos</th><th className="num">Vendidas</th><th className="num">Vendido</th><th>Limite de fotos</th><th>Envio até</th><th></th></tr></thead>
        <tbody>{rows.map((m, i) => (
          <tr key={m.id}>
            <td><b>{i + 1}º {m.display_name || m.name}</b>{m.owner && <span className="badge" style={{ marginLeft: 6 }}>organizador</span>}<div className="tiny muted">{m.email}</div></td>
            <td className="num">{m.photos}</td><td className="num">{m.sold}</td><td className="num">{money(m.cents)}</td>
            <td>{m.owner ? '—' : <input className="input" style={{ height: 34, width: 100 }} type="number" min="1" defaultValue={m.max_photos || ''} placeholder="sem limite" aria-label="Limite de fotos" onBlur={(e) => update(m, 'max_photos', e.target.value)} />}</td>
            <td>{m.owner ? '—' : <input className="input" style={{ height: 34, width: 190 }} type="datetime-local" defaultValue={toLocalInput(m.upload_until)} aria-label="Prazo de envio" onBlur={(e) => update(m, 'upload_until', e.target.value)} />}</td>
            <td>{!m.owner && <button className="btn btn-sm btn-ghost" onClick={() => remove(m)} aria-label="Tirar da equipe"><Trash2 size={14} /></button>}</td>
          </tr>
        ))}</tbody>
      </table></div>

      <form className="row" style={{ gap: 8, alignItems: 'flex-end' }} onSubmit={add}>
        <label className="field" style={{ flex: '1 1 240px' }}><span>E-mail do fotógrafo</span><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="fotografo@email.com" /></label>
        <label className="field" style={{ width: 130 }}><span>Limite de fotos</span><input className="input" type="number" min="1" value={f.max_photos} onChange={(e) => setF({ ...f, max_photos: e.target.value })} placeholder="sem limite" /></label>
        <label className="field" style={{ width: 200 }}><span>Envio até</span><input className="input" type="datetime-local" value={f.upload_until} onChange={(e) => setF({ ...f, upload_until: e.target.value })} /></label>
        <button className="btn btn-accent"><UserPlus size={16} /> Adicionar</button>
      </form>
      <span className="tiny muted">A pessoa precisa ter conta de fotógrafo aprovada no site (com a chave Pix cadastrada para receber).{data.members.some((m) => m.upload_until) ? ` Prazos em horário de Brasília${data.members[0]?.upload_until ? `, ex.: ${dateTimeBR(data.members[0].upload_until)}` : ''}.` : ''}</span>
    </div>
  );
}
