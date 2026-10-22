import { useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { useApi } from '../../lib/site.jsx';
import { money } from '../../lib/format.js';
import { MiniBars } from '../../components/Charts.jsx';

const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

// Desempenho do evento no editor: numeros sempre visiveis, graficos e listas ao abrir.
export default function EventInsights({ eventId }) {
  const [open, setOpen] = useState(false);
  const { data: d } = useApi(`/studio/events/${eventId}/insights`);
  if (!d) return null;
  return (
    <div className="card stack" style={{ gap: 14 }}>
      <div className="row between">
        <h3 className="row" style={{ gap: 8 }}><BarChart3 size={18} /> Desempenho do evento</h3>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? 'Menos' : 'Ver detalhes'}</button>
      </div>
      <div className="kpis">
        <div className="kpi"><span>Vendido</span><b>{money(d.cents)}</b><small>você recebe {money(d.net_cents)}</small></div>
        <div className="kpi"><span>Fotos vendidas</span><b>{d.photos_sold} de {d.photo_count.toLocaleString('pt-BR')}</b><small>{pct(d.pct_sold)} das fotos</small></div>
        <div className="kpi"><span>Pedidos</span><b>{d.orders}</b><small>{d.orders ? `ticket médio ${money(d.ticket_cents)}` : 'nenhum ainda'}</small></div>
        <div className="kpi"><span>Conversão</span><b>{pct(d.conversion)}</b><small>{d.visitors.toLocaleString('pt-BR')} pessoas visitaram</small></div>
      </div>
      {open && (
        <>
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="stack">
              <b className="small">Vendas acumuladas nos primeiros 30 dias</b>
              <MiniBars values={d.first30} labels={d.first30.map((_, i) => `dia ${i + 1}`)} every={5} height={100} format={money} />
            </div>
            <div className="stack">
              <b className="small">Pedidos por horário</b>
              <MiniBars values={d.byHour} labels={d.byHour.map((_, h) => `${h}h`)} every={6} height={100} format={(v) => `${v} pedidos`} />
            </div>
          </div>
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="stack" style={{ gap: 6 }}>
              <b className="small">Quem mais comprou</b>
              {d.topClients.length ? d.topClients.map((c, i) => (
                <div key={i} className="row between small"><span>{i + 1}º {c.name} <span className="muted">· {c.photos} fotos</span></span><b>{money(c.cents)}</b></div>
              )) : <span className="small muted">Ainda sem compras.</span>}
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <b className="small">Cupons mais usados</b>
              {d.coupons.length ? d.coupons.map((c) => (
                <div key={c.code} className="row between small"><span>{c.code}</span><b>{c.uses} {c.uses === 1 ? 'uso' : 'usos'}</b></div>
              )) : <span className="small muted">Nenhum cupom usado neste evento.</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
