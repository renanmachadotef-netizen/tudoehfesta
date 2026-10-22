import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Camera, CalendarDays, ScanFace, Search, ShieldCheck, GraduationCap, Trophy, PartyPopper, LayoutGrid } from 'lucide-react';
import { useApi, useSite, useTitle } from '../lib/site.jsx';
import { compact } from '../lib/format.js';
import EventBrowser, { QUICK_CATS } from '../components/EventBrowser.jsx';

const FAQ = [
  ['Como encontro minhas fotos?', 'Toque em “Achar minhas fotos” e tire uma selfie. O reconhecimento facial procura você em todos os eventos (ou só em um ano, ou só em um evento) e mostra as fotos em que você aparece.'],
  ['Minha selfie fica guardada?', 'Não. A selfie é analisada no seu próprio celular ou computador e vira uma sequência de números usada só para a busca. A imagem não é enviada para o nosso servidor.'],
  ['Como recebo as fotos?', 'Assim que o pagamento é confirmado, as fotos ficam liberadas em “Fotos adquiridas”, em alta resolução e sem marca d’água. Você pode baixar quantas vezes quiser.'],
  ['Quais as formas de pagamento?', 'Pix (aprovação na hora) e cartão de crédito.'],
  ['Sou fotógrafo, posso vender aqui?', 'Pode! Cadastre-se em “Venda suas fotos”: você publica seus eventos, define seus preços e acompanha vendas e saques num painel próprio.'],
];

const QUICK_ICONS = { formaturas: GraduationCap, esportes: Trophy, festas: PartyPopper };

export default function Home() {
  useTitle('');
  const { site, categories = [], years = [], totals = {} } = useSite();
  const facets = useApi('/events/facets');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const covers = facets.data?.covers || {};
  const since = site?.since || 2003;
  const count = (slug) => categories.find((c) => c.slug === slug)?.events || 0;

  const searchEvents = (e) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (q.trim()) next.set('q', q.trim()); else next.delete('q');
    setParams(next, { replace: true, preventScrollReset: true });
    document.getElementById('eventos')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="home">
      {/* Banner com a busca (como no site atual). O banner enviado no admin ja traz a arte; sem ele, mostramos os numeros. */}
      <section className={`home-hero${site?.hero ? ' has-image' : ''}`} style={site?.hero ? { backgroundImage: `url(${site.hero})` } : undefined}>
        <div className="container home-hero-inner">
          <h1>{site?.tagline || 'Eternizando gerações!'}</h1>
          <form className="home-search" onSubmit={searchEvents} role="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procure pelo evento que você participou" aria-label="Procure pelo evento que você participou" />
            <button aria-label="Buscar"><Search size={20} /></button>
          </form>
          {!site?.hero && (
            <div className="home-stats">
              <span><Camera size={30} strokeWidth={1.5} /><b>{totals.photos >= 1000 ? `+${compact(totals.photos)} fotos` : 'Milhares de fotos'}</b></span>
              <span><CalendarDays size={30} strokeWidth={1.5} /><b>Desde {since}</b></span>
              <span><ScanFace size={30} strokeWidth={1.5} /><b>Busca por selfie</b></span>
              <span><ShieldCheck size={30} strokeWidth={1.5} /><b>Confiança e tradição</b></span>
            </div>
          )}
        </div>
      </section>

      {/* Links diretos */}
      <section className="container home-block">
        <div className="home-cats">
          {QUICK_CATS.map((c) => {
            const Icon = QUICK_ICONS[c.slug];
            const n = count(c.slug);
            return (
              <Link key={c.slug} to={c.path} className="home-cat" style={covers[c.slug] ? { backgroundImage: `url(${covers[c.slug]})` } : undefined}>
                <Icon size={26} strokeWidth={1.75} />
                <b>{c.label}</b>
                <span>{n ? `${n} ${n === 1 ? 'evento' : 'eventos'}` : 'Ver eventos'} <ArrowRight size={15} /></span>
              </Link>
            );
          })}
          <Link to="/eventos" className="home-cat home-cat-all">
            <LayoutGrid size={26} strokeWidth={1.75} />
            <b>Todos os eventos</b>
            <span>{totals.events ? `${totals.events} ${totals.events === 1 ? 'evento' : 'eventos'}` : 'Ver todos'} <ArrowRight size={15} /></span>
          </Link>
        </div>
      </section>

      {/* Selfie e acervo por ano */}
      <section className="container">
        <div className="home-selfie">
          <div className="stack" style={{ gap: 6, flex: '1 1 320px' }}>
            <h2 className="home-h2">Não sabe em qual evento está? Tire uma selfie.</h2>
            <p className="muted">O reconhecimento facial procura você em todas as fotos{years.length ? `, de ${years[years.length - 1].year} até hoje` : ''}. A selfie é analisada no seu aparelho e não é enviada a ninguém.</p>
            {years.length > 0 && (
              <div className="chips chips-wrap" style={{ marginTop: 6 }}>
                {years.map((y) => <Link key={y.year} to={`/ano/${y.year}`} className="chip">Fotos de {y.year}</Link>)}
              </div>
            )}
          </div>
          <Link to="/buscar" className="btn btn-accent btn-lg"><ScanFace size={20} /> Achar minhas fotos</Link>
        </div>
      </section>

      {/* Eventos com filtros */}
      <section className="container home-block" id="eventos">
        <EventBrowser title="Eventos recentes" subtitle="Confira os eventos mais recentes que foram fotografados." allPath="/" />
      </section>

      {/* Fotografos */}
      <section className="container">
        <div className="home-pro">
          <div className="stack" style={{ gap: 6 }}>
            <h2 className="home-h2">Fotografa na região?</h2>
            <p>Venda suas fotos aqui: o sistema reconhece os rostos e o Pix cai na sua conta a cada venda. Sem mensalidade.</p>
          </div>
          <Link to="/seja-fotografo" className="btn btn-lg">Quero vender minhas fotos</Link>
        </div>
      </section>

      {/* Perguntas */}
      <section className="container home-block" style={{ maxWidth: 860 }}>
        <h2 className="home-h2">Perguntas frequentes</h2>
        <div>
          {FAQ.map(([q2, a]) => (
            <details key={q2} className="faq">
              <summary>{q2}<span className="muted">+</span></summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
