import { Link } from 'react-router-dom';
import { Plus, Eye, Images, FolderOpen } from 'lucide-react';
import { useApi } from '../../lib/site.jsx';
import { money, dateTimeBR, compact } from '../../lib/format.js';
import { Loading, ErrorBox, Empty } from '../../components/Layout.jsx';
import { Bars, PageHead } from './Studio.jsx';

export default function Dashboard() {
  const { data, loading, error } = useApi('/studio/dashboard');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { totals, series, topEvents, recent, balance, counts } = data;
  const monthTotal = series.reduce((s, d) => s + d.cents, 0);

  return (
    <div className="stack" style={{ gap: 26 }}>
      <PageHead title="Visão geral">
        <Link to="/painel/eventos/novo" className="btn btn-accent btn-sm"><Plus size={16} /> Novo evento</Link>
      </PageHead>

      <div className="kpis">
        <div className="kpi accent"><span>Saldo disponível</span><b>{money(balance.available)}</b><small>{money(balance.pending)} a liberar em até {balance.release_days} dias</small></div>
        <div className="kpi"><span>Hoje</span><b>{money(totals.today)}</b><small>líquido para você</small></div>
        <div className="kpi"><span>Últimos 7 dias</span><b>{money(totals.week)}</b></div>
        <div className="kpi"><span>Este mês</span><b>{money(totals.month)}</b><small>{totals.photos_month} fotos · {totals.buyers_month} clientes</small></div>
      </div>

      <div className="card stack">
        <div className="row between"><h3>Vendas dos últimos 30 dias</h3><b>{money(monthTotal)}</b></div>
        <Bars series={series} format={money} />
      </div>

      <div className="kpis">
        <div className="kpi"><span><FolderOpen size={14} style={{ verticalAlign: -2 }} /> Eventos</span><b>{counts.events}</b></div>
        <div className="kpi"><span><Images size={14} style={{ verticalAlign: -2 }} /> Fotos publicadas</span><b>{compact(counts.photos)}</b></div>
        <div className="kpi"><span><Eye size={14} style={{ verticalAlign: -2 }} /> Visitas nos eventos</span><b>{compact(counts.views)}</b></div>
        <div className="kpi"><span>Total já vendido</span><b>{money(balance.lifetime)}</b></div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <h3>Eventos que mais vendem</h3>
          {topEvents.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Evento</th><th className="num">Visitas</th><th className="num">Fotos</th><th className="num">Líquido</th></tr></thead>
              <tbody>{topEvents.map((e) => (
                <tr key={e.id}>
                  <td><Link to={`/painel/eventos/${e.id}`} style={{ fontWeight: 600 }}>{e.title}</Link>
                    <div className="tiny muted">{e.views ? `${((e.buyers / e.views) * 100).toFixed(1)}% de conversão` : 'sem visitas ainda'}</div></td>
                  <td className="num">{e.views}</td><td className="num">{e.photos_sold}</td><td className="num">{money(e.cents)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="Crie seu primeiro evento"><Link to="/painel/eventos/novo" className="btn btn-accent btn-sm">Novo evento</Link></Empty>}
        </div>
        <div className="stack">
          <h3>Últimas vendas</h3>
          {recent.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Cliente</th><th>Quando</th><th className="num">Líquido</th></tr></thead>
              <tbody>{recent.map((s) => (
                <tr key={s.code}><td><b>{s.buyer}</b><div className="tiny muted">{s.photos} foto(s) · {s.event_title}</div></td><td className="small">{dateTimeBR(s.paid_at)}</td><td className="num">{money(s.cents)}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="muted small">As vendas aparecem aqui em tempo real.</p>}
        </div>
      </div>
    </div>
  );
}
