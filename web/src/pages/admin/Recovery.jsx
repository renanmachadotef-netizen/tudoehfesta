import { useState } from 'react';
import { MessageCircle, Copy, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi, useSite } from '../../lib/site.jsx';
import { money, dateTimeBR, plural } from '../../lib/format.js';
import { Loading, ErrorBox, Empty } from '../../components/Layout.jsx';
import { PageHead } from '../studio/Studio.jsx';

const STATUS = {
  open: ['Em aberto', 'badge-warn'],
  contacted: ['Em contato', 'badge-accent'],
  lost: ['Perdido', 'badge-bad'],
  recovered: ['Recuperado', 'badge-ok'],
};

// Carrinhos e pedidos nao pagos: quem separou fotos e nao concluiu, com mensagem pronta para o WhatsApp.
export default function Recovery() {
  const { toast } = useSite();
  const { data, loading, error, reload } = useApi('/admin/abandoned');
  const [filter, setFilter] = useState('open');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { list, totals } = data;
  const shown = list.filter((x) => filter === 'all' || x.status === filter);
  const setStatus = async (x, status) => {
    await api(`/admin/abandoned/${x.kind}/${x.id}`, { method: 'PUT', body: { status } });
    reload();
  };
  const whatsapp = (x) => {
    window.open(`https://wa.me/${x.wa}?text=${encodeURIComponent(x.message)}`, '_blank', 'noopener');
    if (x.status === 'open') setStatus(x, 'contacted');
  };
  const copy = async (x) => {
    try { await navigator.clipboard.writeText(x.message); toast('Mensagem copiada'); } catch { toast('Não foi possível copiar'); }
  };
  const tile = (k, label) => (
    <button type="button" className={`kpi recovery-tile${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
      <span>{label}</span>
      <b>{money(totals[k].cents)}</b>
      <small>{plural(totals[k].n, 'cliente', 'clientes')} · {plural(totals[k].items, 'foto', 'fotos')}</small>
    </button>
  );

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead title="Carrinhos abandonados">
        <button className={`btn btn-sm ${filter === 'all' ? '' : 'btn-ghost'}`} onClick={() => setFilter('all')}>Ver todos</button>
      </PageHead>
      <p className="small muted" style={{ maxWidth: 720 }}>
        Quem separou fotos e não pagou: pedidos com Pix gerado, pedidos que expiraram e carrinhos parados há mais de 30 minutos de quem está logado.
        O botão do WhatsApp abre a conversa com a mensagem pronta e um link que leva a pessoa direto de volta às fotos dela.
      </p>
      <div className="kpis">
        {tile('open', 'Em aberto')}
        {tile('contacted', 'Em contato')}
        {tile('recovered', 'Recuperados')}
        {tile('lost', 'Perdidos')}
      </div>
      {shown.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Cliente</th><th>O que separou</th><th className="num">Valor</th><th>Quando</th><th>Situação</th><th></th></tr></thead>
          <tbody>{shown.map((x) => (
            <tr key={`${x.kind}-${x.id}`}>
              <td><b>{x.name}</b><div className="tiny muted">{x.email}{x.phone ? ` · ${x.phone}` : ''}</div></td>
              <td className="small">{plural(x.items, 'foto', 'fotos')}{x.events ? ` · ${x.events}` : ''}<div className="tiny muted">{x.stage}{x.kind === 'order' ? ` · pedido ${x.ref}` : ''}</div></td>
              <td className="num"><b>{money(x.total_cents)}</b></td>
              <td className="small">{dateTimeBR(x.updated_at)}{x.contacted_at && <div className="tiny muted">contato {dateTimeBR(x.contacted_at)}</div>}</td>
              <td>
                {x.status === 'recovered' ? <span className="badge badge-ok">Recuperado</span> : (
                  <select className="select" style={{ height: 32, width: 130, fontSize: 13 }} value={x.status} onChange={(e) => setStatus(x, e.target.value)} aria-label="Situação">
                    <option value="open">Em aberto</option>
                    <option value="contacted">Em contato</option>
                    <option value="lost">Perdido</option>
                  </select>
                )}
              </td>
              <td><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                {x.status !== 'recovered' && x.wa && <button className="btn btn-sm btn-accent" onClick={() => whatsapp(x)}><MessageCircle size={14} /> WhatsApp</button>}
                {x.status !== 'recovered' && <button className="btn btn-sm btn-ghost" onClick={() => copy(x)} title="Copiar mensagem"><Copy size={14} /></button>}
                <a className="btn btn-sm btn-ghost" href={x.link} target="_blank" rel="noreferrer" title="Abrir o link que o cliente recebe"><ExternalLink size={14} /></a>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title={filter === 'open' ? 'Nenhum carrinho esperando contato' : 'Nada por aqui'}>Quando alguém separar fotos e não concluir a compra, aparece aqui.</Empty>}
      {totals.recovered.n > 0 && (
        <p className="small muted">{STATUS.recovered[0]}: {plural(totals.recovered.n, 'cliente voltou', 'clientes voltaram')} e pagou {money(totals.recovered.cents)} depois de abandonar.</p>
      )}
    </div>
  );
}
