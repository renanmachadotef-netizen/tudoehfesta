import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../lib/site.jsx';
import { money, compact } from '../../lib/format.js';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import { MiniBars, HBars } from '../../components/Charts.jsx';
import { PageHead } from '../studio/Studio.jsx';

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PAGES = { inicio: 'Página inicial', evento: 'Páginas de evento', ano: 'Páginas de ano', selfie: 'Busca com selfie', eventos: 'Lista de eventos', carrinho: 'Carrinho', pedido: 'Pedido', outras: 'Outras' };
const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

// Visitas e conversao: de quantas pessoas que entraram, quantas compraram, e quando e por onde elas chegam.
export default function Visits() {
  const [days, setDays] = useState(30);
  const { data, loading, error } = useApi(`/admin/visits?days=${days}`);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead title="Visitas e conversão">
        <div className="chips">
          {[7, 30, 90, 365].map((d) => <button key={d} className={`chip${days === d ? ' active' : ''}`} onClick={() => setDays(d)}>{d === 365 ? '1 ano' : `${d} dias`}</button>)}
        </div>
      </PageHead>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : <Report d={data} />}
    </div>
  );
}

function Report({ d }) {
  const t = d.totals;
  const conv = t.visitors ? t.orders / t.visitors : 0;
  const labels = d.byDay.map((x) => `${x.day.slice(8, 10)}/${x.day.slice(5, 7)}`);
  const every = Math.ceil(d.byDay.length / 8);
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>Visitas</span><b>{t.visits.toLocaleString('pt-BR')}</b><small>{t.visitors.toLocaleString('pt-BR')} pessoas diferentes</small></div>
        <div className="kpi"><span>Pedidos pagos</span><b>{t.orders}</b><small>{t.photos} fotos vendidas</small></div>
        <div className="kpi accent"><span>Conversão</span><b>{pct(conv)}</b><small>das pessoas que entraram compraram</small></div>
        <div className="kpi"><span>Vendido</span><b>{money(t.cents)}</b><small>{t.orders ? `ticket médio ${money(Math.round(t.cents / t.orders))}` : 'sem vendas no período'}</small></div>
      </div>
      <div className="card stack">
        <h3>Pessoas por dia</h3>
        <MiniBars values={d.byDay.map((x) => x.visitors)} labels={labels} every={every} format={(v) => `${v} pessoas`} />
      </div>
      <div className="card stack">
        <h3>Vendas por dia</h3>
        <MiniBars values={d.byDay.map((x) => x.cents)} labels={labels} every={every} format={money} />
      </div>
      <div className="grid-3" style={{ alignItems: 'start' }}>
        <div className="card stack"><h3>Dia da semana</h3><MiniBars values={d.byWeekday} labels={WEEK} height={90} format={(v) => `${v} visitas`} /></div>
        <div className="card stack"><h3>Horário</h3><MiniBars values={d.byHour} labels={d.byHour.map((_, h) => `${h}h`)} every={6} height={90} format={(v) => `${v} visitas`} /></div>
        <div className="card stack"><h3>Aparelho</h3><HBars rows={d.byDevice.map((x) => ({ label: x.k, value: x.visitors }))} /></div>
      </div>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack"><h3>Onde as pessoas entram</h3><HBars rows={d.byPage.map((x) => ({ label: PAGES[x.k] || x.k, value: x.visits }))} format={compact} /></div>
        <div className="card stack">
          <h3>Eventos mais vistos</h3>
          {d.topEvents.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Evento</th><th className="num">Pessoas</th><th className="num">Pedidos</th><th className="num">Conversão</th><th className="num">Vendido</th></tr></thead>
              <tbody>{d.topEvents.map((e) => (
                <tr key={e.id}>
                  <td><Link to={`/painel/eventos/${e.id}`} style={{ fontWeight: 600 }}>{e.title}</Link></td>
                  <td className="num">{e.visitors}</td><td className="num">{e.orders}</td><td className="num">{pct(e.conversion)}</td><td className="num">{money(e.cents)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="small muted">As visitas às páginas de evento aparecem aqui.</p>}
        </div>
      </div>
      <p className="tiny muted">Contagem própria, sem cookie e sem guardar IP: cada pessoa vira um código anônimo que muda todo dia. Robôs e visitas ao painel ficam de fora. Os números começam a partir de hoje.</p>
    </>
  );
}
