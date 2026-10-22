import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanFace, Calendar, ArrowRight, RefreshCw, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSite, useTitle } from '../lib/site.jsx';
import { dateBR, plural } from '../lib/format.js';
import { PhotoGrid } from '../components/Photos.jsx';
import SelfieSearch from '../components/SelfieSearch.jsx';
import { Empty } from '../components/Layout.jsx';
import { useOwned } from './Event.jsx';
import BuyAll from '../components/BuyAll.jsx';

// Convite para cadastrar o rosto e receber fotos novas automaticamente.
function WatchInvite() {
  const { user } = useSite();
  return (
    <div className="alert row" style={{ gap: 10, justifyContent: 'space-between' }}>
      <span className="small"><b>Quer receber suas fotos novas automaticamente?</b> Cadastre seu rosto e avisamos sempre que você aparecer numa foto.</span>
      <Link className="btn btn-sm btn-accent" to={user ? '/meu-rosto' : '/cadastro?voltar=/meu-rosto'}>Ativar</Link>
    </div>
  );
}

// Resultado da busca facial agrupado por evento.
export function FaceResults({ result, refine }) {
  const owned = useOwned();
  if (!result) return null;
  if (!result.photos.length) {
    return (
      <Empty icon={ScanFace} title="Ainda não encontramos você">
        Tente outra selfie (de frente, sem boné ou óculos escuros) ou navegue pelos eventos. Novas fotos entram toda semana.
      </Empty>
    );
  }
  const groups = result.events.map((ev) => ({ ev, photos: result.photos.filter((p) => p.event_id === ev.id) })).filter((g) => g.photos.length);
  const evById = new Map(result.events.map((e) => [e.id, e]));
  const withInfo = (p) => {
    const ev = evById.get(p.event_id);
    return { ...p, event_title: ev?.title, event_slug: ev?.slug, price_cents: ev?.price_cents };
  };

  return (
    <div className="stack" style={{ gap: 30 }}>
      <WatchInvite />
      <span><b>{plural(result.photos.length, 'foto', 'fotos')}</b> com você em {plural(groups.length, 'evento', 'eventos')}{refine?.seeds.length ? ` (selfie + ${plural(refine.seeds.length, 'foto marcada', 'fotos marcadas')})` : ''}</span>
      {refine && <RefinePanel refine={refine} />}
      <BuyAll photos={result.photos.filter((p) => !owned.has(p.id)).map(withInfo)} />
      {groups.map(({ ev, photos }) => (
        <section key={ev.id} className="stack" style={{ gap: 12 }}>
          <div className="row between">
            <div>
              {ev.kind === 'pool' ? <h3>{ev.title} <span className="badge" style={{ verticalAlign: 3 }}>Acervo {String(ev.event_date).slice(0, 4)}</span></h3> : <Link to={`/evento/${ev.slug}`}><h3>{ev.title}</h3></Link>}
              <span className="small muted row" style={{ gap: 5 }}><Calendar size={13} /> {dateBR(ev.event_date)} {ev.city && `· ${ev.city}`} · {plural(photos.length, 'foto', 'fotos')}</span>
            </div>
            {ev.kind !== 'pool' && <Link to={`/evento/${ev.slug}`} className="btn btn-sm btn-ghost">Ver evento <ArrowRight size={14} /></Link>}
          </div>
          <PhotoGrid photos={photos} rowHeight={180} owned={owned} eventInfo={{ event_title: ev.title, event_slug: ev.slug, price_cents: ev.price_cents }}
            picked={refine ? new Set(refine.seeds.map((s) => s.id)) : undefined} onPick={refine?.toggle} />
        </section>
      ))}
    </div>
  );
}

// Fotos marcadas como "sou eu" e o botao de buscar de novo com elas.
function RefinePanel({ refine }) {
  const { seeds, pending, toggle, again, busy } = refine;
  return (
    <div className="refine">
      <div className="stack" style={{ gap: 4, flex: '1 1 300px' }}>
        <b>Seu rosto mudou com os anos?</b>
        <span className="small muted">Toque em <b>“Sou eu?”</b> nas fotos em que você aparece e busque de novo: cada foto marcada vira mais uma referência do seu rosto e ajuda a achar fotos de outras épocas. Troque o ano e as fotos marcadas continuam valendo.</span>
        {seeds.length > 0 && (
          <div className="refine-seeds">
            {seeds.map((s) => (
              <button key={s.id} type="button" onClick={() => toggle(s)} title="Tirar esta foto da busca" aria-label="Tirar esta foto da busca">
                <img src={s.thumb} alt="" /><X size={12} />
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-accent" disabled={busy || !pending} onClick={again}>
        <RefreshCw size={16} /> {pending ? `Buscar de novo com ${plural(seeds.length, 'foto marcada', 'fotos marcadas')}` : seeds.length ? 'Marque mais fotos para buscar de novo' : 'Marque ao menos uma foto'}
      </button>
    </div>
  );
}

export function useFaceSearch(scopeBody) {
  const { toast } = useSite();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selfie, setSelfie] = useState(null);
  const [seeds, setSeeds] = useState([]); // [{ id, thumb }]
  const [searched, setSearched] = useState(''); // fotos marcadas usadas na ultima busca
  const scopeKey = JSON.stringify(scopeBody);

  const search = async (sf, list = seeds) => {
    setBusy(true);
    try {
      const d = await api('/faces/search', { method: 'POST', body: { descriptors: [sf.descriptor], seeds: list.map((s) => s.id), ...scopeBody } });
      // Foto marcada cujo rosto nao confere com a selfie (nem com outra marcada) fica de fora.
      const used = new Set(d.seeds || []);
      const kept = list.filter((s) => used.has(s.id));
      if (kept.length < list.length) toast('Algumas fotos marcadas não foram usadas: o rosto nelas não confere com a sua selfie.');
      setSeeds(kept);
      setSearched(kept.map((s) => s.id).join(','));
      setResult(d);
      setTimeout(() => document.getElementById('resultados')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const run = (sf) => { setSelfie(sf); return search(sf); };

  // Trocou o ano: busca de novo no ano novo com a mesma selfie e as fotos marcadas.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (selfie) search(selfie); else setResult(null);
  }, [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (p) => setSeeds((list) => (list.some((s) => s.id === p.id)
    ? list.filter((s) => s.id !== p.id)
    : list.length >= 12 ? (toast('Marque no máximo 12 fotos.'), list) : [...list, { id: p.id, thumb: p.thumb }]));
  const refine = selfie && {
    seeds, toggle, busy,
    pending: seeds.length > 0 && seeds.map((s) => s.id).join(',') !== searched,
    again: () => search(selfie),
  };
  return { result, busy, run, refine, reset: () => setResult(null) };
}

export default function SearchPage() {
  useTitle('Buscar fotos com selfie');
  const { years = [] } = useSite();
  const [year, setYear] = useState('');
  const { result, busy, run, refine } = useFaceSearch(year ? { scope: 'year', year } : { scope: 'all' });
  const span = years.length ? ` (${years[years.length - 1].year} a ${years[0].year})` : '';

  return (
    <div className="container section-sm stack" style={{ gap: 24, maxWidth: 1100 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Reconhecimento facial</span>
        <h1 style={{ fontSize: 'clamp(28px,4vw,42px)' }}>Encontre todas as suas fotos de uma vez</h1>
        <p className="muted">Uma selfie procura você em todo o acervo ou só no ano que você escolher.</p>
      </div>
      <div className="chips chips-wrap">
        <button className={`chip${!year ? ' active' : ''}`} onClick={() => setYear('')}>Todos os anos</button>
        {years.map((y) => (
          <button key={y.year} className={`chip${String(year) === String(y.year) ? ' active' : ''}`} onClick={() => setYear(String(y.year))}>
            {y.year} <em>{y.events}</em>
          </button>
        ))}
      </div>
      <SelfieSearch onSelfie={run} busy={busy} scopeNote={year ? `Procurando só nas fotos de ${year}` : `Procurando em todo o acervo${span}`} />
      <div id="resultados"><FaceResults result={result} refine={refine} /></div>
    </div>
  );
}
