import { useState } from 'react';
import { MessageCircle, Download, ScanFace } from 'lucide-react';
import { useApi } from '../../lib/site.jsx';
import { money, dateBR, plural } from '../../lib/format.js';
import { Loading, ErrorBox, Empty } from '../../components/Layout.jsx';
import { PageHead } from '../studio/Studio.jsx';

// Clientes: quem comprou, quanto, quando e de quais eventos. Base para chamar de volta quando sair evento novo.
export default function Clients() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('total');
  const [all, setAll] = useState(false);
  const { data, loading, error } = useApi(`/admin/clients?sort=${sort}&q=${encodeURIComponent(query)}${all ? '&all=1' : ''}`);
  const list = data?.clients || [];
  const total = list.reduce((s, c) => s + c.total_cents, 0);
  const buyers = list.filter((c) => c.orders > 0).length;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Clientes">
        <a className="btn btn-sm btn-ghost" href="/api/admin/clients.csv"><Download size={14} /> Exportar CSV</a>
      </PageHead>
      <div className="row" style={{ gap: 8 }}>
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
          <input className="input" style={{ height: 38, width: 260 }} placeholder="Nome, e-mail ou WhatsApp" aria-label="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <select className="select" style={{ height: 38, width: 210 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          <option value="total">Quem mais gastou</option>
          <option value="orders">Mais pedidos</option>
          <option value="recent">Compra mais recente</option>
          <option value="name">Nome</option>
        </select>
        <label className="check" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Incluir cadastrados sem compra
        </label>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : list.length ? (
        <>
          <span className="small muted">{plural(buyers, 'cliente comprou', 'clientes compraram')} · {money(total)} no total{all ? ` · ${plural(list.length - buyers, 'cadastro sem compra', 'cadastros sem compra')}` : ''}</span>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Cliente</th><th>WhatsApp</th><th className="num">Pedidos</th><th className="num">Fotos</th><th className="num">Total</th><th>Última compra</th><th>Eventos</th></tr></thead>
            <tbody>{list.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b> {c.has_face && <ScanFace size={13} aria-label="Rosto cadastrado" style={{ verticalAlign: -2, color: 'var(--accent)' }} />}<div className="tiny muted">{c.email}</div></td>
                <td className="small">{c.wa ? <a href={`https://wa.me/${c.wa}`} target="_blank" rel="noreferrer" className="row" style={{ gap: 5 }}><MessageCircle size={14} /> {c.phone}</a> : <span className="muted">—</span>}</td>
                <td className="num">{c.orders}</td>
                <td className="num">{c.photos}</td>
                <td className="num"><b>{money(c.total_cents)}</b></td>
                <td className="small">{c.last_purchase ? dateBR(c.last_purchase) : <span className="muted">cadastro em {dateBR(c.created_at)}</span>}</td>
                <td className="small muted" style={{ maxWidth: 260 }}>{c.events || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      ) : <Empty title="Nenhum cliente ainda">Quem comprar fotos aparece aqui.</Empty>}
    </div>
  );
}
