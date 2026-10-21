import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { PhotoGrid } from '../components/Photos.jsx';
import { useOwned } from './Event.jsx';
import { useApi, useSite, useTitle } from '../lib/site.jsx';
import { plural } from '../lib/format.js';
import { EventCard, EventGridSkeleton } from '../components/Photos.jsx';
import SelfieSearch from '../components/SelfieSearch.jsx';
import { FaceResults, useFaceSearch } from './Search.jsx';

export default function YearPage() {
  const { year } = useParams();
  const { years = [] } = useSite();
  useTitle(`Fotos de ${year}`);
  const events = useApi(`/events?year=${year}&limit=60`);
  const { result, busy, run } = useFaceSearch({ scope: 'year', year });
  const info = years.find((y) => String(y.year) === String(year));
  const owned = useOwned();
  const [gallery, setGallery] = useState({ list: [], more: false, loading: true });
  useEffect(() => {
    setGallery({ list: [], more: false, loading: true });
    api(`/years/${year}/photos?limit=120`).then((d) => setGallery({ list: d.photos, more: d.more, loading: false })).catch(() => setGallery({ list: [], more: false, loading: false }));
  }, [year]);
  const loadMore = async () => {
    const d = await api(`/years/${year}/photos?limit=120&offset=${gallery.list.length}`);
    setGallery((g) => ({ list: [...g.list, ...d.photos], more: d.more, loading: false }));
  };

  return (
    <div className="container section-sm stack" style={{ gap: 28 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Retrospectiva</span>
        <h1 style={{ fontSize: 'clamp(30px,5vw,48px)' }}>Todas as fotos de {year}</h1>
        <p className="muted">{info ? `${info.photos.toLocaleString('pt-BR')} fotos em ${year}. ` : ''}Tire uma selfie e veja você em todas as fotos do ano de uma só vez.</p>
      </div>
      <div className="chips">
        {years.map((y) => (
          <Link key={y.year} to={`/ano/${y.year}`} className={`chip${String(y.year) === String(year) ? ' active' : ''}`}>{y.year}</Link>
        ))}
      </div>
      <SelfieSearch onSelfie={run} busy={busy} title={`Você em ${year}`} subtitle={`Uma selfie procura você em todos os eventos de ${year}.`} />
      <div id="resultados"><FaceResults result={result} /></div>
      {(events.loading || events.data?.events?.length > 0) && <h2>Eventos de {year}</h2>}
      {events.loading ? <EventGridSkeleton /> : events.data?.events?.length > 0 && (
        <div className="events-grid">{events.data.events.map((e) => <EventCard key={e.id} event={e} />)}</div>
      )}
      <div className="row between"><h2>Todas as fotos de {year}</h2>{info && <span className="small muted">{plural(info.photos, 'foto', 'fotos')}</span>}</div>
      {gallery.loading ? <EventGridSkeleton n={4} /> : gallery.list.length ? (
        <>
          <PhotoGrid photos={gallery.list} rowHeight={180} owned={owned} />
          {gallery.more && <div className="center"><button className="btn btn-ghost" onClick={loadMore}>Carregar mais fotos</button></div>}
        </>
      ) : <p className="muted">As fotos de {year} aparecem aqui assim que forem publicadas.</p>}
    </div>
  );
}
