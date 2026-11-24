import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ScanFace, Search, GraduationCap, Trophy, PartyPopper, LayoutGrid } from 'lucide-react';
import { useApi, useSite, useTitle } from '../lib/site.jsx';
import EventBrowser, { QUICK_CATS } from '../components/EventBrowser.jsx';

const FAQ = [
  ['Como encontro minhas fotos?', 'Toque em “Achar minhas fotos” e tire uma selfie. O reconhecimento facial procura você em todos os eventos (ou só em um ano, ou só em um evento) e mostra as fotos em que você aparece.'],
  ['Minha selfie fica guardada?', 'Não. A selfie é enviada com segurança ao nosso servidor só para virar uma sequência de números usada na busca, e a imagem é descartada na hora, sem ser gravada.'],
  ['Como recebo as fotos?', 'Assim que o pagamento é confirmado, as fotos ficam liberadas em “Fotos adquiridas”, em alta resolução e sem marca d’água. Você pode baixar quantas vezes quiser.'],
  ['Quais as formas de pagamento?', 'Pix (aprovação na hora) e cartão de crédito.'],
  ['Sou fotógrafo, posso vender aqui?', 'Pode! Cadastre-se em “Seja fotógrafo parceiro”, no rodapé do site: você publica seus eventos, define seus preços e acompanha vendas e saques num painel próprio.'],
];

const QUICK_ICONS = { formaturas: GraduationCap, esportes: Trophy, festas: PartyPopper };

export default function Home() {
  useTitle('');
  const { site, years = [] } = useSite();
  const facets = useApi('/events/facets');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const covers = facets.data?.covers || {};

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
          <h1 className="sr-only">{site?.tagline || 'Eternizando gerações!'}</h1>
          <form className="home-search" onSubmit={searchEvents} role="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar evento" aria-label="Procure pelo evento que você participou" />
            <button aria-label="Buscar"><Search size={20} /></button>
          </form>
        </div>
      </section>

      {/* Links diretos */}
      <section className="container home-block">
        <div className="home-cats">
          {QUICK_CATS.map((c) => {
            const Icon = QUICK_ICONS[c.slug];
            return (
              <Link key={c.slug} to={c.path} className="home-cat" style={covers[c.slug] ? { backgroundImage: `url(${covers[c.slug]})` } : undefined}>
                <Icon size={26} strokeWidth={1.75} />
                <b>{c.label}</b>
              </Link>
            );
          })}
          <Link to="/eventos" className="home-cat home-cat-all">
            <LayoutGrid size={26} strokeWidth={1.75} />
            <b>Todos os eventos</b>
          </Link>
        </div>
      </section>

      {/* Selfie e acervo por ano */}
      <section className="container">
        <div className="home-selfie">
          <div className="stack" style={{ gap: 6, flex: '1 1 320px' }}>
            <h2 className="home-h2">Não sabe em qual evento está? Tire uma selfie.</h2>
            <p className="muted">O reconhecimento facial procura você em todas as fotos{years.length ? `, de ${years[years.length - 1].year} até hoje` : ''}. A selfie vira um código numérico e a foto é descartada na hora: não guardamos sua selfie.</p>
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

      {/* Perguntas */}
      <section className="container home-block home-faq">
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
