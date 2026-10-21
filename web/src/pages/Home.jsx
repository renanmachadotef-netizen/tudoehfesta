import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ScanFace, Search, Check, Download, ShoppingBag } from 'lucide-react';
import { useApi, useSite, useTitle } from '../lib/site.jsx';
import { compact } from '../lib/format.js';
import { EventCard, EventGridSkeleton } from '../components/Photos.jsx';

const FAQ = [
  ['Como encontro minhas fotos?', 'Toque em “Achar minhas fotos” e tire uma selfie. Nosso reconhecimento facial procura você em todos os eventos (ou só em um ano, ou só em um evento) e mostra as fotos em que você aparece.'],
  ['Minha selfie fica guardada?', 'Não. A selfie é analisada dentro do seu próprio celular ou computador e vira uma sequência de números usada só para a busca. A imagem não é enviada para o nosso servidor.'],
  ['Como recebo as fotos?', 'Assim que o pagamento é confirmado, as fotos ficam liberadas em “Minhas fotos”, em alta resolução e sem marca d’água. Você pode baixar quantas vezes quiser.'],
  ['Quais as formas de pagamento?', 'Pix (aprovação na hora) e cartão de crédito.'],
  ['Comprando mais fotos fica mais barato?', 'Sim. Muitos eventos têm desconto progressivo e pacote com teto: a partir de certa quantidade, você leva todas as suas fotos pelo mesmo preço.'],
  ['Sou fotógrafo, posso vender aqui?', 'Pode! Cadastre-se em “Venda suas fotos”. Você publica seus eventos, define seus preços e acompanha vendas e saques num painel próprio.'],
];

export default function Home() {
  useTitle('');
  const { site, categories = [], years = [], totals = {} } = useSite();
  const recent = useApi('/events?limit=12');
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const covers = (recent.data?.events || []).filter((e) => e.cover_thumb).slice(0, 12);

  return (
    <>
      <section className="hero">
        {covers.length >= 6 && (
          <div className="hero-bg" aria-hidden="true">
            {covers.map((e) => <img key={e.id} src={e.cover_thumb} alt="" />)}
          </div>
        )}
        <div className="container">
          <div className="hero-inner">
            <span className="eyebrow">{site?.tagline || 'Eternizando gerações!'} · desde {site?.since || 2003}</span>
            <h1>Sua história, nossas fotos, <b>grandes momentos.</b></h1>
            <p className="lead">
              Festas, formaturas, jantares e eventos esportivos do Extremo Sul Catarinense. Tire uma selfie e encontre todas as fotos em que você aparece.
            </p>
            <div className="row">
              <Link to="/buscar" className="btn btn-accent btn-lg"><ScanFace size={20} /> Achar minhas fotos</Link>
              <Link to="/eventos" className="btn btn-light btn-lg">Ver eventos</Link>
            </div>
            <form
              className="hero-search"
              onSubmit={(e) => {
                e.preventDefault();
                nav(`/eventos${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
              }}
            >
              <Search size={19} color="#74706a" style={{ marginLeft: 10, alignSelf: 'center' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procure pelo evento, cidade ou local" aria-label="Buscar evento" />
              <button className="btn">Buscar</button>
            </form>
            <div className="stats">
              <div><b>{compact(Math.max(totals.photos || 0, 0))}</b><span>fotos publicadas</span></div>
              <div><b>{compact(totals.events || 0)}</b><span>eventos</span></div>
              <div><b>{new Date().getFullYear() - (site?.since || 2003)} anos</b><span>de história</span></div>
            </div>
          </div>
        </div>
      </section>

      {years.length > 0 && (
        <section className="section-sm">
          <div className="container stack">
            <div className="stack" style={{ gap: 4 }}>
              <h2>Localize sua foto pelo ano</h2>
              <span className="muted">Escolha o ano e tire uma selfie: procuramos você em todas as fotos daquele ano, de todos os eventos.</span>
            </div>
            <div className="year-grid">
              {years.map((y) => (
                <Link key={y.year} to={`/ano/${y.year}`} className="year-card">
                  <b>{y.year}</b>
                  <span>{compact(y.photos)} fotos</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section-sm">
        <div className="container stack" style={{ gap: 22 }}>
          <div className="row between">
            <h2>Eventos recentes</h2>
            <Link to="/eventos" className="btn btn-sm btn-ghost">Ver todos <ArrowRight size={15} /></Link>
          </div>
          {recent.loading ? <EventGridSkeleton /> : recent.data?.events?.length ? (
            <div className="events-grid">
              {recent.data.events.map((e) => <EventCard key={e.id} event={e} />)}
            </div>
          ) : (
            <p className="muted">Os primeiros eventos aparecem aqui assim que forem publicados.</p>
          )}
        </div>
      </section>

      {categories.some((c) => c.events > 0) && (
        <section className="section-sm">
          <div className="container stack" style={{ gap: 18 }}>
            <h2>Categorias</h2>
            <div className="cat-grid">
              {categories.filter((c) => c.events > 0).map((c) => (
                <Link key={c.id} to={`/categoria/${c.slug}`} className="cat-tile">
                  <b>{c.name}</b>
                  <span className="small muted">{c.events} {c.events === 1 ? 'evento' : 'eventos'}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="container stack" style={{ gap: 22 }}>
          <h2>Como funciona</h2>
          <div className="steps">
            <div className="step"><i>1</i><h3><ScanFace size={18} style={{ verticalAlign: -3 }} /> Tire uma selfie</h3><p className="muted small">Buscamos você em um evento, num ano inteiro ou em todo o acervo.</p></div>
            <div className="step"><i>2</i><h3><ShoppingBag size={18} style={{ verticalAlign: -3 }} /> Escolha e pague</h3><p className="muted small">Pix com aprovação na hora ou cartão. Quanto mais fotos, maior o desconto.</p></div>
            <div className="step"><i>3</i><h3><Download size={18} style={{ verticalAlign: -3 }} /> Baixe em alta</h3><p className="muted small">Fotos sem marca d’água, liberadas na hora e disponíveis sempre em “Minhas fotos”.</p></div>
          </div>
        </div>
      </section>

      <section className="section-sm">
        <div className="container">
          <div className="dark-band">
            <div className="stack">
              <span className="eyebrow" style={{ color: 'var(--gold)' }}>Para fotógrafos da região</span>
              <h2>Transforme cada evento em uma renda extra.</h2>
              <p>Publique suas fotos, deixe o reconhecimento facial levar cada cliente até a foto dele e acompanhe tudo num painel de gestão simples.</p>
              <div className="row"><Link to="/seja-fotografo" className="btn btn-accent">Quero vender minhas fotos</Link></div>
            </div>
            <ul>
              {['Sem mensalidade: comissão só quando vender', 'Reconhecimento facial ilimitado', 'Preço, desconto progressivo, pacote e cupons por evento', 'Painel com vendas, saldo e saque via Pix', 'QR Code do evento para divulgar no local'].map((t) => (
                <li key={t}><Check size={18} color="#ffb21a" style={{ flex: 'none', marginTop: 2 }} /> {t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ maxWidth: 820 }}>
          <h2 style={{ marginBottom: 10 }}>Perguntas frequentes</h2>
          {FAQ.map(([q2, a]) => (
            <details key={q2} className="faq">
              <summary>{q2}<span className="muted">+</span></summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
