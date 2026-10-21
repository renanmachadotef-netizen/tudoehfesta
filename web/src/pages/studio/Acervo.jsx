import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, FolderOpen, Images, ScanFace, ShoppingBag, ChevronDown, ChevronUp, Camera, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi, useSite } from '../../lib/site.jsx';
import { money, dateBR, plural, compact } from '../../lib/format.js';
import { Loading, ErrorBox, Empty } from '../../components/Layout.jsx';
import { PageHead } from './Studio.jsx';

// Fotos de um grupo, em miniatura (so para o dono/admin: o publico so ve pela selfie).
function GroupPhotos({ id }) {
  const { data, loading } = useApi(`/studio/events/${id}/photos`);
  if (loading) return <span className="small muted">Carregando fotos…</span>;
  const photos = data?.photos || [];
  if (!photos.length) return <span className="small muted">Nenhuma foto pronta ainda.</span>;
  return (
    <div className="acervo-thumbs">
      {photos.map((p) => (
        <a key={p.id} href={p.preview} target="_blank" rel="noreferrer" title={`${p.name || ''}${p.faces ? ` · ${p.faces} rosto(s)` : ''}${p.sold ? ` · vendida ${p.sold}x` : ''}`}>
          <img src={p.thumb} alt="" loading="lazy" />
          {p.sold > 0 && <span className="acervo-sold">vendida</span>}
        </a>
      ))}
    </div>
  );
}

function Group({ g, admin, onPurged }) {
  const { toast } = useSite();
  const [open, setOpen] = useState(false);
  const pool = g.kind === 'pool';
  const purge = async () => {
    const typed = prompt(`Excluir "${g.title}" do site, com as ${g.photo_count} fotos${g.sold ? ` e os pedidos dele (${g.sold} fotos vendidas)` : ''}?\n`
      + 'As fotos continuam no seu Google Drive e não voltam na próxima sincronização (para trazer de volta: Google Drive → Ver recusadas → Revisar de novo).\n\n'
      + 'Digite o nome exato para confirmar:');
    if (typed == null) return;
    try {
      const d = await api(`/admin/events/${g.id}/purge`, { method: 'POST', body: { confirm: typed } });
      toast(`Excluído: ${d.photos} fotos`);
      onPurged();
    } catch (err) { toast(err.message); }
  };
  return (
    <div className="card stack" style={{ gap: 12, padding: 14 }}>
      <div className="row" style={{ flexWrap: 'nowrap', gap: 14, alignItems: 'flex-start' }}>
        {g.cover_thumb ? <img src={g.cover_thumb} alt="" className="acervo-cover" />
          : <div className="acervo-cover" style={{ display: 'grid', placeItems: 'center', background: 'var(--surface-2)' }}><Camera size={18} /></div>}
        <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <b>{g.title}</b>
            {pool ? <span className="badge">Acervo · só selfie</span> : <span className="badge badge-ok">Evento{g.category_name ? ` · ${g.category_name}` : ''}</span>}
            {!pool && <span className="badge">{g.hide_gallery ? 'Só selfie' : 'Galeria aberta'}</span>}
            {g.status !== 'published' && <span className="badge badge-warn">{g.status === 'draft' ? 'Rascunho' : g.status}</span>}
          </div>
          <span className="tiny muted">
            {dateBR(g.event_date)}{g.drive_folder_path && <> · <FolderOpen size={11} style={{ verticalAlign: -1 }} /> {g.drive_folder_path}</>}
          </span>
          <span className="small">
            {plural(g.photo_count, 'foto', 'fotos')} · {plural(g.faces, 'rosto', 'rostos')}
            {g.pending > 0 && <span className="muted"> · {g.pending} processando</span>}
            {' · '}{g.sold ? <b>{g.sold} vendidas · {money(g.sold_cents)}</b> : <span className="muted">sem vendas</span>}
          </span>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-sm btn-soft" onClick={() => setOpen(!open)}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? 'Esconder fotos' : 'Ver fotos'}</button>
        {pool ? <Link to="/painel/eventos/novo" className="btn btn-sm btn-ghost" title="Crie o evento e use “Puxar do acervo” para trazer estas fotos">Criar evento com estas fotos</Link>
          : <Link to={`/painel/eventos/${g.id}`} className="btn btn-sm btn-ghost">Editar evento</Link>}
        {!pool && g.status === 'published' && <Link to={`/evento/${g.slug}`} className="btn btn-sm btn-ghost">Ver no site</Link>}
        {admin && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--bad)', marginLeft: 'auto' }} onClick={purge}><Trash2 size={14} /> Excluir do site</button>}
      </div>
      {open && <GroupPhotos id={g.id} />}
    </div>
  );
}

export default function Acervo() {
  const { user } = useSite();
  const [year, setYear] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi(`/studio/acervo${year ? `?year=${year}` : ''}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { years, groups } = data;
  const cur = years.find((y) => y.year === data.year);
  const text = q.trim().toLowerCase();
  const list = groups.filter((g) => (filter === 'all' || g.kind === filter)
    && (!text || [g.title, g.tag, g.drive_folder_path].some((s) => s?.toLowerCase().includes(text))));

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead title="Acervo por ano" />
      {!years.length ? (
        <Empty icon={Archive} title="Nenhuma foto ainda">
          <Link to="/painel/drive" className="btn btn-accent btn-sm">Ligar a pasta do Google Drive</Link>
        </Empty>
      ) : (
        <>
          <div className="chips">
            {years.map((y) => (
              <button key={y.year} className={`chip${y.year === data.year ? ' active' : ''}`} onClick={() => setYear(y.year)}>{y.year} <em>{compact(y.photos)}</em></button>
            ))}
          </div>
          {cur && (
            <div className="kpis">
              <div className="kpi"><span><Images size={14} style={{ verticalAlign: -2 }} /> Fotos em {cur.year}</span><b>{cur.photos.toLocaleString('pt-BR')}</b>{cur.pending > 0 && <small>{cur.pending} processando</small>}</div>
              <div className="kpi"><span><FolderOpen size={14} style={{ verticalAlign: -2 }} /> Pastas e eventos</span><b>{cur.groups + cur.events}</b><small>{plural(cur.groups, 'pasta só no acervo', 'pastas só no acervo')} · {plural(cur.events, 'evento cadastrado', 'eventos cadastrados')}</small></div>
              <div className="kpi"><span><ScanFace size={14} style={{ verticalAlign: -2 }} /> Rostos encontrados</span><b>{cur.faces.toLocaleString('pt-BR')}</b></div>
              <div className="kpi accent"><span><ShoppingBag size={14} style={{ verticalAlign: -2 }} /> Vendido em {cur.year}</span><b>{money(cur.sold_cents)}</b><small>{plural(cur.sold, 'foto vendida', 'fotos vendidas')} (valor bruto)</small></div>
            </div>
          )}
          <div className="row" style={{ gap: 10 }}>
            <div className="tabs" style={{ marginBottom: 0 }}>
              <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tudo</button>
              <button className={filter === 'pool' ? 'active' : ''} onClick={() => setFilter('pool')}>Só no acervo</button>
              <button className={filter === 'event' ? 'active' : ''} onClick={() => setFilter('event')}>Eventos cadastrados</button>
            </div>
            <input className="input grow" style={{ maxWidth: 320 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por nome ou pasta" />
          </div>
          <p className="small muted">As fotos do acervo não ficam expostas no site: o público só as encontra pela selfie. Aqui você vê tudo para conferir.</p>
          {list.length ? list.map((g) => <Group key={g.id} g={g} admin={user.role === 'admin'} onPurged={reload} />)
            : <p className="muted">Nada encontrado{text ? ' com esse filtro' : ''}.</p>}
        </>
      )}
    </div>
  );
}
