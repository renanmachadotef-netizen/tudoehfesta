import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ScanFace, Search, ShieldCheck } from 'lucide-react';
import { useApi, useSite, useTitle } from '../lib/site.jsx';
import { compact } from '../lib/format.js';
import { EventCard, EventGridSkeleton } from '../components/Photos.jsx';

const FAQ = [
  ['Como encontro minhas fotos?', 'Toque em “Achar minhas fotos” e tire uma selfie. Nosso reconhecimento facial procura você em todos os eventos (ou só em um ano, ou só em um evento) e mostra as fotos em que você aparece.'],
  ['Minha selfie fica guardada?', 'Não. A selfie é analisada dentro do seu próprio celular ou computador e vira uma sequência de números usada só para a busca. A imagem não é enviada para o nosso servidor.'],
  ['Como recebo as fotos?', 'Assim que o pagamento é confirmado, as fotos ficam liberadas em “Fotos adquiridas”, em alta resolução e sem marca d’água. Você pode baixar quantas vezes quiser.'],
  ['Quais as formas de pagamento?', 'Pix (aprovação na hora) e cartão de crédito.'],
  ['Comprando mais fotos fica mais barato?', 'Sim. Muitos eventos têm desconto progressivo e pacote com teto: a partir de certa quantidade, você leva todas as suas fotos pelo mesmo preço.'],
  ['Sou fotógrafo, posso vender aqui?', 'Pode! Cadastre-se em “Sou fotógrafo”. Você publica seus eventos, define seus preços e acompanha vendas e saques num painel próprio.'],
];

// Tons de negativo para os quadros da folha de contato quando ainda nao ha capas de evento.
const TONES = ['#3A2A22', '#5B3B2B', '#2B2F3A', '#6E4A33', '#43302A', '#7A5A3E', '#2F2623', '#55402F', '#3C3530', '#684232', '#2A2420', '#4D3A2C'];
const MOSAIC = ['#6E4A33', '#8A5E40', '#A9774F', '#C2916A', '#5B3B2B', '#3A2A22', '#D3A985', '#7A5A3E'];
const CAT_HINTS = { festas: 'aniversários, 15 anos', formaturas: 'colação e baile', jantares: 'confraternizações', esportes: 'corridas, torneios', outros: 'o resto da vida' };

// A folha de contato: negativos numerados e o lapis do fotografo circulando "voce".
function ContactSheet({ covers }) {
  const frames = TONES.map((tone, i) => ({ tone, cover: covers[i] || null, num: `${14 + Math.floor(i / 2)}${i % 2 ? 'A' : ''}` }));
  const holes = Array.from({ length: 14 }, (_, i) => i);
  return (
    <div className="lp-sheet-wrap">
      <div className="lp-sheet">
        <div className="lp-holes" aria-hidden="true">{holes.map((h) => <span key={h} />)}</div>
        <div className="lp-frames">
          {frames.map((f, i) => (
            <figure key={f.num} className="lp-frame">
              <div className="lp-frame-img" style={{ background: f.tone }}>
                {f.cover && <img src={f.cover} alt="" loading="lazy" />}
              </div>
              <figcaption>{f.num} ▸</figcaption>
              {i === 5 && (
                <svg className="lp-circle" viewBox="0 0 120 100" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M60 6 C 98 4, 116 26, 112 52 C 108 82, 76 96, 50 93 C 18 90, 4 70, 8 44 C 12 20, 36 7, 64 9 C 80 10, 92 14, 100 20" />
                </svg>
              )}
            </figure>
          ))}
        </div>
        <div className="lp-holes" aria-hidden="true">{holes.map((h) => <span key={h} />)}</div>
      </div>
      <span className="lp-note lp-note-sheet" aria-hidden="true">é você aqui!</span>
    </div>
  );
}

export default function Home() {
  useTitle('');
  const { site, categories = [], years = [], totals = {} } = useSite();
  const recent = useApi('/events?limit=6');
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const since = site?.since || 2003;
  const now = new Date().getFullYear();
  const covers = (recent.data?.events || []).map((e) => e.cover_thumb).filter(Boolean);
  const withPhotos = new Set(years.filter((y) => y.photos > 0).map((y) => Number(y.year)));
  const archive = Array.from({ length: now - since + 1 }, (_, i) => now - i);

  return (
    <div className="lp">
      {/* Abertura */}
      <section className="lp-hero container">
        <div className="lp-hero-text">
          <span className="lp-kicker">Folha nº {now} · Extremo Sul Catarinense</span>
          <h1 className="lp-h1">Você estava lá.<br /><em>A gente guardou.</em></h1>
          <p className="lp-lead">
            {now - since} anos fotografando festas, formaturas e encontros da região. Tire uma selfie: nós circulamos você em cada foto,
            como o fotógrafo marca a melhor pose na prova.
          </p>
          <div className="row">
            <Link to="/buscar" className="btn btn-accent btn-lg"><ScanFace size={20} /> Tirar minha selfie</Link>
            <Link to="/eventos" className="btn btn-ghost btn-lg">Ver os eventos</Link>
          </div>
          <p className="lp-fine"><ShieldCheck size={15} /> A selfie é analisada no seu celular e não é enviada a ninguém.</p>
        </div>
        <ContactSheet covers={covers} />
      </section>

      {/* Numeros */}
      <section className="lp-strip" aria-label="Em números">
        <div className="container lp-strip-inner">
          <span><b>{now - since}</b> anos de festa</span>
          <span><b>{compact(totals.photos || 0)}</b> fotos no acervo</span>
          <span><b>{compact(totals.events || 0)}</b> eventos</span>
          <span><b>3 s</b> para achar você</span>
        </div>
      </section>

      {/* Como funciona */}
      <section className="lp-paper">
        <div className="container lp-block">
          <div className="lp-head">
            <h2 className="lp-h2">Do flash ao seu celular, <em>em três gestos.</em></h2>
            <p className="lp-muted">Sem procurar foto por foto, sem rolar mil miniaturas. O reconhecimento facial faz a parte chata.</p>
          </div>
          <ol className="lp-steps">
            <li><span className="lp-num">01</span><h3>Uma selfie</h3><p>De frente, com boa luz. Ela é lida no seu aparelho: o rosto vira um código, a foto não sai daí.</p></li>
            <li><span className="lp-num">02</span><h3>Nós circulamos você</h3><p>Num evento, num ano inteiro ou em todo o acervo desde {since}. Aparecem só as fotos em que você está.</p></li>
            <li><span className="lp-num">03</span><h3>Leve a original</h3><p>Pague no Pix ou cartão e baixe na hora, em alta resolução e sem marca d’água.</p></li>
          </ol>
        </div>
      </section>

      {/* Arquivo por ano */}
      <section className="container lp-block" id="anos">
        <div className="lp-head">
          <div className="stack" style={{ gap: 12 }}>
            <span className="lp-kicker">O arquivo</span>
            <h2 className="lp-h2">Em que ano <em className="lp-accent">foi a festa?</em></h2>
          </div>
          <p className="lp-muted">Escolha o ano e tire uma selfie: procuramos você em todas as festas daquele ano de uma vez.</p>
        </div>
        <div className="lp-years">
          {archive.map((y) => (withPhotos.has(y)
            ? <Link key={y} to={`/ano/${y}`} className="lp-year">{y}</Link>
            : <span key={y} className="lp-year lp-year-off" aria-label={`${y}: em digitalização`}>{y}</span>))}
        </div>
        <p className="lp-kicker">Anos em tinta já têm fotos · os contornados estão sendo digitalizados</p>
      </section>

      {/* Tipos de evento + busca */}
      <section className="lp-rule">
        <div className="container lp-block lp-split">
          <div className="lp-split-side">
            <span className="lp-kicker">Tipos de evento</span>
            <h2 className="lp-h2 lp-h2-sm">Lembra qual <em>noite</em> era?</h2>
            <p className="lp-muted">Vá direto ao evento e veja você e seus amigos.</p>
            <form
              className="lp-search"
              onSubmit={(e) => {
                e.preventDefault();
                nav(`/eventos${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
              }}
            >
              <Search size={18} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do evento, cidade ou local" aria-label="Buscar evento" />
              <button className="btn btn-sm">Buscar</button>
            </form>
          </div>
          <ul className="lp-cats">
            {categories.map((c, i) => (
              <li key={c.id}>
                <Link to={`/categoria/${c.slug}`}>
                  <span className="lp-cat-n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="lp-cat-name">{c.name}</span>
                  <span className="lp-cat-hint">{c.events ? `${c.events} ${c.events === 1 ? 'evento' : 'eventos'}` : CAT_HINTS[c.slug] || ''}</span>
                  <ArrowRight size={22} className="lp-accent" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Eventos recentes */}
      <section className="lp-sand">
        <div className="container lp-block">
          <div className="row between">
            <h2 className="lp-h2 lp-h2-sm">Saindo do laboratório</h2>
            <Link to="/eventos" className="btn btn-sm btn-ghost">Todos os eventos <ArrowRight size={15} /></Link>
          </div>
          {recent.loading ? <EventGridSkeleton n={3} /> : recent.data?.events?.length ? (
            <div className="events-grid">{recent.data.events.map((e) => <EventCard key={e.id} event={e} />)}</div>
          ) : <p className="lp-muted">Os primeiros eventos aparecem aqui assim que forem publicados.</p>}
        </div>
      </section>

      {/* Privacidade */}
      <section className="container lp-block lp-privacy" id="privacidade">
        <div className="lp-mosaic-wrap" aria-hidden="true">
          <div className="lp-mosaic">
            {Array.from({ length: 120 }, (_, i) => {
              const r = Math.floor(i / 10);
              const c = i % 10;
              return <span key={i} style={{ background: MOSAIC[(r * 7 + c * 3 + ((r * c) % 5)) % MOSAIC.length] }} />;
            })}
          </div>
          <span className="lp-note lp-note-mosaic">só você vê o original</span>
        </div>
        <div className="stack" style={{ gap: 20, flex: '1 1 420px', minWidth: 0 }}>
          <span className="lp-kicker">Borrar minhas imagens</span>
          <h2 className="lp-h2">Sua imagem, <em className="lp-accent">suas regras.</em></h2>
          <p className="lp-lead">Não quer aparecer? Cadastre seu rosto e ligue o mosaico: em todas as fotos, para todo mundo, seu rosto vira pixels. Na sua conta, você continua se vendo normalmente.</p>
          <ul className="lp-dashes">
            <li>Você some da busca por selfie de outras pessoas</li>
            <li>Fotos novas em que você aparecer chegam em “Encontradas para você”</li>
            <li>Desliga quando quiser, e tudo volta ao normal</li>
          </ul>
          <Link to="/meu-rosto" className="btn btn-ghost btn-lg" style={{ alignSelf: 'flex-start' }}>Cadastrar meu rosto</Link>
        </div>
      </section>

      {/* Fotografos */}
      <section className="lp-orange">
        <div className="container lp-block lp-orange-inner">
          <h2 className="lp-h2">Fotografa na região? <em>Seu cartão de memória vale dinheiro.</em></h2>
          <div className="stack" style={{ gap: 14, maxWidth: 360 }}>
            <p>Suba as fotos, o sistema reconhece os rostos e o Pix cai na sua conta a cada venda. Sem mensalidade: comissão só quando vender.</p>
            <Link to="/seja-fotografo" className="btn btn-lg" style={{ alignSelf: 'flex-start' }}>Quero vender minhas fotos</Link>
          </div>
        </div>
      </section>

      {/* Perguntas */}
      <section className="container lp-block" style={{ maxWidth: 860 }}>
        <h2 className="lp-h2 lp-h2-sm">Perguntas frequentes</h2>
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
