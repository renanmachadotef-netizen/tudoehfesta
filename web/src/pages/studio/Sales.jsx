import { useState } from 'react';
import { Download } from 'lucide-react';
import { useApi } from '../../lib/site.jsx';
import { money, dateTimeBR } from '../../lib/format.js';
import { Loading, ErrorBox, Empty } from '../../components/Layout.jsx';
import { PageHead } from './Studio.jsx';

function toCsv(rows) {
  const head = ['pedido', 'data', 'cliente', 'evento', 'fotos', 'bruto', 'comissao', 'liquido'];
  const lines = rows.map((s) => [s.code, s.paid_at, s.buyer, s.event_title, s.photos, s.gross_cents / 100, s.commission_cents / 100, s.net_cents / 100]
    .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
  return '﻿' + [head.join(';'), ...lines].join('\n');
}

export default function Sales() {
  const events = useApi('/studio/events');
  const [eventId, setEventId] = useState('');
  const { data, loading, error } = useApi(`/studio/sales${eventId ? `?event=${eventId}` : ''}`);
  const sales = data?.sales || [];
  const sum = (k) => sales.reduce((s, x) => s + x[k], 0);
  const csv = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(sales)], { type: 'text/csv;charset=utf-8' }));
    a.download = `vendas-tudoehfesta-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Vendas">
        <select className="select" style={{ width: 240, height: 38 }} value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">Todos os eventos</option>
          {(events.data?.events || []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        {sales.length > 0 && <button className="btn btn-sm btn-soft" onClick={csv}><Download size={14} /> Planilha</button>}
      </PageHead>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !sales.length ? <Empty title="Nenhuma venda ainda" /> : (
        <>
          <div className="kpis">
            <div className="kpi"><span>Vendido (bruto)</span><b>{money(sum('gross_cents'))}</b></div>
            <div className="kpi"><span>Comissão da plataforma</span><b>{money(sum('commission_cents'))}</b></div>
            <div className="kpi accent"><span>Seu líquido</span><b>{money(sum('net_cents'))}</b></div>
            <div className="kpi"><span>Fotos vendidas</span><b>{sum('photos')}</b></div>
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Data</th><th>Cliente</th><th>Evento</th><th className="num">Fotos</th><th className="num">Bruto</th><th className="num">Líquido</th></tr></thead>
            <tbody>{sales.map((s) => (
              <tr key={s.code + s.event_slug}><td className="small">{dateTimeBR(s.paid_at)}</td><td>{s.buyer}</td><td className="small">{s.event_title}</td>
                <td className="num">{s.photos}</td><td className="num">{money(s.gross_cents)}</td><td className="num"><b>{money(s.net_cents)}</b></td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </div>
  );
}
