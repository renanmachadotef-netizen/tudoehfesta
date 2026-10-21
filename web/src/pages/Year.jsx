import { useParams, Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useApi, useSite, useTitle } from '../lib/site.jsx';
import { EventCard, EventGridSkeleton } from '../components/Photos.jsx';
import SelfieSearch from '../components/SelfieSearch.jsx';
import { FaceResults, useFaceSearch } from './Search.jsx';

// Fotos do ano: so por reconhecimento facial. Cada pessoa ve apenas as fotos em que aparece.
export default function YearPage() {
  const { year } = useParams();
  const { years = [] } = useSite();
  useTitle(`Suas fotos de ${year}`);
  const events = useApi(`/events?year=${year}&limit=60`);
  const { result, busy, run } = useFaceSearch({ scope: 'year', year });
  const info = years.find((y) => String(y.year) === String(year));

  return (
    <div className="container section-sm stack" style={{ gap: 28 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Retrospectiva</span>
        <h1 style={{ fontSize: 'clamp(30px,5vw,48px)' }}>Suas fotos de {year}</h1>
        <p className="muted">{info ? `${info.photos.toLocaleString('pt-BR')} fotos em ${year}. ` : ''}Tire uma selfie e veja todas as fotos do ano em que você aparece, de uma só vez.</p>
        <span className="small muted row" style={{ gap: 6 }}><Lock size={14} /> As fotos do ano não ficam expostas: cada pessoa vê apenas as fotos em que aparece.</span>
      </div>
      <div className="chips">
        {years.map((y) => (
          <Link key={y.year} to={`/ano/${y.year}`} className={`chip${String(y.year) === String(year) ? ' active' : ''}`}>{y.year}</Link>
        ))}
      </div>
      <SelfieSearch onSelfie={run} busy={busy} title={`Você em ${year}`} subtitle={`Uma selfie procura você em todas as fotos de ${year}.`} />
      <div id="resultados"><FaceResults result={result} /></div>
      {(events.loading || events.data?.events?.length > 0) && <h2>Eventos de {year}</h2>}
      {events.loading ? <EventGridSkeleton /> : events.data?.events?.length > 0 && (
        <div className="events-grid">{events.data.events.map((e) => <EventCard key={e.id} event={e} />)}</div>
      )}
    </div>
  );
}
