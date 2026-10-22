import { Link } from 'react-router-dom';
import { Plus, Camera, ScanFace } from 'lucide-react';
import { useApi } from '../../lib/site.jsx';
import { money, dateBR } from '../../lib/format.js';
import { Loading, ErrorBox, Empty } from '../../components/Layout.jsx';
import { PageHead } from './Studio.jsx';

export const EVENT_STATUS = { draft: ['Rascunho', ''], published: ['Publicado', 'badge-ok'], hidden: ['Oculto', 'badge-warn'] };

export default function EventsList() {
  const { data, loading, error } = useApi('/studio/events');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const events = data.events;
  return (
    <div>
      <PageHead title="Eventos"><Link to="/painel/eventos/novo" className="btn btn-accent btn-sm"><Plus size={16} /> Novo evento</Link></PageHead>
      {!events.length ? (
        <Empty title="Nenhum evento ainda"><Link to="/painel/eventos/novo" className="btn btn-accent">Criar o primeiro</Link></Empty>
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th></th><th>Evento</th><th>Status</th><th className="num">Fotos</th><th className="num">Rostos</th><th className="num">Visitas</th><th className="num">Vendido</th></tr></thead>
          <tbody>{events.map((e) => (
            <tr key={e.id}>
              <td style={{ width: 72 }}>
                <Link to={`/painel/eventos/${e.id}`}>
                  {e.cover_thumb ? <img src={e.cover_thumb} alt="" style={{ width: 60, height: 44, objectFit: 'cover', borderRadius: 6 }} />
                    : <div style={{ width: 60, height: 44, borderRadius: 6, background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }}><Camera size={16} /></div>}
                </Link>
              </td>
              <td><Link to={`/painel/eventos/${e.id}`} style={{ fontWeight: 650 }}>{e.title}</Link>{e.kind === 'pool' && <span className="badge" style={{ marginLeft: 6 }} title="Criado pela pasta do Drive: aparece só na busca e na galeria do ano">Acervo do ano</span>}{e.is_team && <span className="badge badge-accent" style={{ marginLeft: 6 }} title="Você é fotógrafo convidado neste evento">Colaboração</span>}<div className="tiny muted">{dateBR(e.event_date)} · {e.city || 'sem cidade'} · {money(e.price_cents)}/foto</div></td>
              <td><span className={`badge ${EVENT_STATUS[e.status][1]}`}>{EVENT_STATUS[e.status][0]}</span></td>
              <td className="num">{e.photo_count}</td>
              <td className="num"><ScanFace size={13} style={{ verticalAlign: -2 }} /> {e.face_count}</td>
              <td className="num">{e.views}</td>
              <td className="num">{money(e.revenue_cents)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
