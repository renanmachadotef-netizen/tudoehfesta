import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Search, ScanFace } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSite, useTitle } from '../lib/site.jsx';
import { EventCard, EventGridSkeleton } from '../components/Photos.jsx';
import { Empty } from '../components/Layout.jsx';

const PAGE = 24;

export default function Events() {
  const { category } = useParams();
  const [params, setParams] = useSearchParams();
  const { categories = [], years = [] } = useSite();
  const year = params.get('ano') || '';
  const q = params.get('q') || '';
  const [text, setText] = useState(q);
  const [list, setList] = useState({ events: [], more: false, loading: true });
  const cat = categories.find((c) => c.slug === category);
  useTitle(cat ? cat.name : 'Eventos');

  useEffect(() => { setText(q); }, [q]);

  useEffect(() => {
    let alive = true;
    setList((l) => ({ ...l, loading: true, events: [] }));
    const qs = new URLSearchParams({ limit: PAGE });
    if (category) qs.set('category', category);
    if (year) qs.set('year', year);
    if (q) qs.set('q', q);
    api(`/events?${qs}`).then((d) => alive && setList({ ...d, loading: false })).catch(() => alive && setList({ events: [], more: false, loading: false }));
    return () => { alive = false; };
  }, [category, year, q]);

  const loadMore = async () => {
    const qs = new URLSearchParams({ limit: PAGE, offset: list.events.length });
    if (category) qs.set('category', category);
    if (year) qs.set('year', year);
    if (q) qs.set('q', q);
    const d = await api(`/events?${qs}`);
    setList((l) => ({ events: [...l.events, ...d.events], more: d.more, loading: false }));
  };

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <div className="container section-sm stack" style={{ gap: 22 }}>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">{cat ? 'Categoria' : 'Acervo'}</span>
          <h1 style={{ fontSize: 'clamp(28px,4vw,40px)' }}>{cat ? cat.name : 'Todos os eventos'}</h1>
        </div>
        <Link to={year ? `/ano/${year}` : '/buscar'} className="btn btn-accent btn-sm"><ScanFace size={16} /> Buscar com selfie</Link>
      </div>

      <form className="row" onSubmit={(e) => { e.preventDefault(); setParam('q', text.trim()); }}>
        <div className="grow" style={{ position: 'relative', minWidth: 220 }}>
          <Search size={17} style={{ position: 'absolute', left: 14, top: 14 }} color="#74706a" />
          <input className="input" style={{ paddingLeft: 40 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Nome do evento, cidade, local ou fotógrafo" />
        </div>
        <select className="select" style={{ width: 150 }} value={year} onChange={(e) => setParam('ano', e.target.value)} aria-label="Ano">
          <option value="">Todos os anos</option>
          {years.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
        </select>
        <button className="btn">Buscar</button>
      </form>

      <div className="chips">
        <Link to={`/eventos${year ? `?ano=${year}` : ''}`} className={`chip${!category ? ' active' : ''}`}>Todos</Link>
        {categories.filter((c) => c.events > 0).map((c) => (
          <Link key={c.id} to={`/categoria/${c.slug}${year ? `?ano=${year}` : ''}`} className={`chip${category === c.slug ? ' active' : ''}`}>
            {c.name} <em>{c.events}</em>
          </Link>
        ))}
      </div>

      {list.loading ? <EventGridSkeleton /> : list.events.length ? (
        <>
          <div className="events-grid">{list.events.map((e) => <EventCard key={e.id} event={e} />)}</div>
          {list.more && <div className="center"><button className="btn btn-ghost" onClick={loadMore}>Carregar mais eventos</button></div>}
        </>
      ) : (
        <Empty title="Nenhum evento encontrado">Tente outro nome, ano ou categoria.</Empty>
      )}
    </div>
  );
}
