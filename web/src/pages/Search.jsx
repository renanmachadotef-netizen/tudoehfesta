import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanFace, ShoppingBag, Calendar, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSite, useTitle } from '../lib/site.jsx';
import { cart, useCart } from '../lib/cart.js';
import { dateBR, plural } from '../lib/format.js';
import { PhotoGrid } from '../components/Photos.jsx';
import SelfieSearch from '../components/SelfieSearch.jsx';
import { Empty } from '../components/Layout.jsx';
import { useOwned } from './Event.jsx';

// Resultado da busca facial agrupado por evento.
export function FaceResults({ result }) {
  const { items } = useCart();
  const { toast } = useSite();
  const owned = useOwned();
  if (!result) return null;
  if (!result.photos.length) {
    return (
      <Empty icon={ScanFace} title="Ainda não encontramos você">
        Tente outra selfie (de frente, sem boné ou óculos escuros) ou navegue pelos eventos. Novas fotos entram toda semana.
      </Empty>
    );
  }
  const inCart = new Set(items.map((i) => i.id));
  const groups = result.events.map((ev) => ({ ev, photos: result.photos.filter((p) => p.event_id === ev.id) })).filter((g) => g.photos.length);
  const allMissing = result.photos.filter((p) => !inCart.has(p.id) && !owned.has(p.id));
  const evById = new Map(result.events.map((e) => [e.id, e]));
  const withInfo = (p) => {
    const ev = evById.get(p.event_id);
    return { ...p, event_title: ev?.title, event_slug: ev?.slug, price_cents: ev?.price_cents };
  };

  return (
    <div className="stack" style={{ gap: 30 }}>
      <div className="row between card-flat" style={{ padding: 16 }}>
        <span><b>{plural(result.photos.length, 'foto', 'fotos')}</b> em {plural(groups.length, 'evento', 'eventos')}</span>
        {allMissing.length > 0 && (
          <button className="btn btn-accent btn-sm" onClick={() => { cart.add(allMissing.map(withInfo)); toast(`${allMissing.length} fotos no carrinho`); }}>
            <ShoppingBag size={15} /> Adicionar todas ({allMissing.length})
          </button>
        )}
      </div>
      {groups.map(({ ev, photos }) => (
        <section key={ev.id} className="stack" style={{ gap: 12 }}>
          <div className="row between">
            <div>
              <Link to={`/evento/${ev.slug}`}><h3>{ev.title}</h3></Link>
              <span className="small muted row" style={{ gap: 5 }}><Calendar size={13} /> {dateBR(ev.event_date)} {ev.city && `· ${ev.city}`} · {plural(photos.length, 'foto', 'fotos')}</span>
            </div>
            <Link to={`/evento/${ev.slug}`} className="btn btn-sm btn-ghost">Ver evento <ArrowRight size={14} /></Link>
          </div>
          <PhotoGrid photos={photos} rowHeight={180} owned={owned} eventInfo={{ event_title: ev.title, event_slug: ev.slug, price_cents: ev.price_cents }} />
        </section>
      ))}
    </div>
  );
}

export function useFaceSearch(scopeBody) {
  const { toast } = useSite();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (selfie) => {
    setBusy(true);
    try {
      setResult(await api('/faces/search', { method: 'POST', body: { descriptors: [selfie.descriptor], ...scopeBody } }));
      setTimeout(() => document.getElementById('resultados')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  return { result, busy, run, reset: () => setResult(null) };
}

export default function SearchPage() {
  useTitle('Buscar fotos com selfie');
  const { years = [] } = useSite();
  const [year, setYear] = useState('');
  const { result, busy, run, reset } = useFaceSearch(year ? { scope: 'year', year } : { scope: 'all' });

  return (
    <div className="container section-sm stack" style={{ gap: 24, maxWidth: 1100 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Reconhecimento facial</span>
        <h1 style={{ fontSize: 'clamp(28px,4vw,42px)' }}>Encontre todas as suas fotos de uma vez</h1>
        <p className="muted">Uma selfie procura você em todo o acervo ou só no ano que você escolher.</p>
      </div>
      <div className="chips">
        <button className={`chip${!year ? ' active' : ''}`} onClick={() => { setYear(''); reset(); }}>Todos os anos</button>
        {years.map((y) => (
          <button key={y.year} className={`chip${String(year) === String(y.year) ? ' active' : ''}`} onClick={() => { setYear(String(y.year)); reset(); }}>
            {y.year} <em>{y.events}</em>
          </button>
        ))}
      </div>
      <SelfieSearch onSelfie={run} busy={busy} />
      <div id="resultados"><FaceResults result={result} /></div>
    </div>
  );
}
