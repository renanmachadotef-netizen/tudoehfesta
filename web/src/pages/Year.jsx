import { useParams, Link } from 'react-router-dom';
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

  return (
    <div className="container section-sm stack" style={{ gap: 28 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Retrospectiva</span>
        <h1 style={{ fontSize: 'clamp(30px,5vw,48px)' }}>Todas as fotos de {year}</h1>
        <p className="muted">{info ? `${plural(info.events, 'evento', 'eventos')} em ${year}. ` : ''}Tire uma selfie e veja você em todos os eventos do ano de uma só vez.</p>
      </div>
      <div className="chips">
        {years.map((y) => (
          <Link key={y.year} to={`/ano/${y.year}`} className={`chip${String(y.year) === String(year) ? ' active' : ''}`}>{y.year}</Link>
        ))}
      </div>
      <SelfieSearch onSelfie={run} busy={busy} title={`Você em ${year}`} subtitle={`Uma selfie procura você em todos os eventos de ${year}.`} />
      <div id="resultados"><FaceResults result={result} /></div>
      <h2>Eventos de {year}</h2>
      {events.loading ? <EventGridSkeleton /> : (
        <div className="events-grid">{(events.data?.events || []).map((e) => <EventCard key={e.id} event={e} />)}</div>
      )}
    </div>
  );
}
