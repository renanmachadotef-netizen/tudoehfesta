import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSite } from '../lib/site.jsx';
import { MONTH_NAMES } from '../lib/format.js';
import { EventCard, EventGridSkeleton } from './Photos.jsx';
import { Empty } from './Layout.jsx';

// Categorias com endereco proprio (links diretos do menu e da pagina inicial).
export const QUICK_CATS = [
  { slug: 'formaturas', path: '/formaturas', label: 'Formaturas' },
  { slug: 'esportes', path: '/esportes', label: 'Esportes' },
  { slug: 'festas', path: '/festas', label: 'Festas' },
];
export const catPath = (slug) => QUICK_CATS.find((c) => c.slug === slug)?.path || `/categoria/${slug}`;
export const catLabel = (c) => QUICK_CATS.find((q) => q.slug === c.slug)?.label || c.name;

const PAGE = 24;
const FILTERS = ['q', 'ano', 'mes', 'cidade'];

// Lista de eventos com filtros (texto, categoria, ano, mes e cidade). Os filtros ficam no endereco,
// entao o link filtrado pode ser compartilhado.
export default function EventBrowser({ category, title, subtitle, allPath = '/eventos', actions, heading: H = 'h2' }) {
  const [params, setParams] = useSearchParams();
  const { search } = useLocation();
  const { categories = [] } = useSite();
  const [q, year, month, city] = FILTERS.map((k) => params.get(k) || '');
  const [text, setText] = useState(q);
  const facets = useApi(`/events/facets${category ? `?category=${encodeURIComponent(category)}` : ''}`);
  const [list, setList] = useState({ events: [], more: false, loading: true });

  useEffect(() => { setText(q); }, [q]);

  const fetchPage = (offset) => {
    const qs = new URLSearchParams({ limit: PAGE, offset });
    if (category) qs.set('category', category);
    if (year) qs.set('year', year);
    if (month) qs.set('month', month);
    if (city) qs.set('city', city);
    if (q) qs.set('q', q);
    return api(`/events?${qs}`);
  };

  useEffect(() => {
    let alive = true;
    setList((l) => ({ ...l, loading: true, events: [] }));
    fetchPage(0)
      .then((d) => alive && setList({ ...d, loading: false }))
      .catch(() => alive && setList({ events: [], more: false, loading: false }));
    return () => { alive = false; };
  }, [category, year, month, city, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    const d = await fetchPage(list.events.length);
    setList((l) => ({ events: [...l.events, ...d.events], more: d.more, loading: false }));
  };

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const clear = () => {
    const next = new URLSearchParams(params);
    FILTERS.forEach((k) => next.delete(k));
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const active = FILTERS.filter((k) => params.get(k)).length;
  const cities = facets.data?.cities || [];
  const years = facets.data?.years || [];
  const shownCats = categories.filter((c) => c.events > 0 || QUICK_CATS.some((x) => x.slug === c.slug));

  return (
    <div className="stack" style={{ gap: 18 }}>
      {(title || actions) && (
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <div className="stack" style={{ gap: 4 }}>
            {title && <H className="home-h2">{title}</H>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}

      <form className="filters" onSubmit={(e) => { e.preventDefault(); setParam('q', text.trim()); }}>
        <label className="filters-search">
          <Search size={18} aria-hidden="true" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nome do evento, local ou cidade" aria-label="Buscar evento" />
        </label>
        <select className="select" value={year} onChange={(e) => setParam('ano', e.target.value)} aria-label="Ano">
          <option value="">Todos os anos</option>
          {years.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
        </select>
        <select className="select" value={month} onChange={(e) => setParam('mes', e.target.value)} aria-label="Mês">
          <option value="">Todos os meses</option>
          {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select className="select" value={city} onChange={(e) => setParam('cidade', e.target.value)} aria-label="Cidade">
          <option value="">Todas as cidades</option>
          {cities.map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}
        </select>
        <button className="btn btn-accent">Buscar</button>
      </form>

      <div className="row between" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <div className="chips" style={{ flex: '1 1 0' }}>
          <Link to={`${allPath}${search}`} className={`chip${!category ? ' active' : ''}`} preventScrollReset>Todos</Link>
          {shownCats.map((c) => (
            <Link key={c.id} to={`${catPath(c.slug)}${search}`} className={`chip${category === c.slug ? ' active' : ''}`}>
              {catLabel(c)} {c.events > 0 && <em>{c.events}</em>}
            </Link>
          ))}
        </div>
        {active > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={clear}><X size={15} /> Limpar filtros</button>}
      </div>

      {list.loading ? <EventGridSkeleton /> : list.events.length ? (
        <>
          <div className="events-grid">{list.events.map((e) => <EventCard key={e.id} event={e} />)}</div>
          {list.more && <div className="center"><button className="btn btn-ghost" onClick={loadMore}>Carregar mais eventos</button></div>}
        </>
      ) : (
        <Empty title="Nenhum evento encontrado">
          {active ? 'Tente outro nome, ano, mês ou cidade.' : 'Os eventos aparecem aqui assim que forem publicados.'}
        </Empty>
      )}
    </div>
  );
}
