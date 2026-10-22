import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Calendar, MapPin, Camera, Share2, ShoppingBag, ScanFace, Tag, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSite, useTitle } from '../lib/site.jsx';
import { cart, useCart } from '../lib/cart.js';
import { dateBR, money, plural } from '../lib/format.js';
import { PhotoGrid } from '../components/Photos.jsx';
import SelfieSearch from '../components/SelfieSearch.jsx';
import BuyAll from '../components/BuyAll.jsx';
import { Loading, Empty, ErrorBox } from '../components/Layout.jsx';

export function PriceSummary({ event }) {
  const tiers = event.discount_tiers || [];
  return (
    <div className="price-box">
      <div className="row between">
        <span className="small muted">Preço por foto{event.archived && <> · <span className="badge">preço de acervo</span></>}</span>
        <b className="big">{money(event.price_cents)}</b>
      </div>
      {tiers.map((t) => (
        <div key={t.min} className="row small" style={{ gap: 8 }}>
          <Tag size={14} color="var(--accent)" /> Levando {t.min} ou mais: <b>{t.pct}% de desconto</b>
        </div>
      ))}
      {event.pack_price_cents && (
        <div className="row small" style={{ gap: 8 }}>
          <ShoppingBag size={14} color="var(--accent)" /> Todas as suas fotos deste evento por no máximo <b>{money(event.pack_price_cents)}</b>
        </div>
      )}
    </div>
  );
}

// Fotos que o cliente ja comprou (para marcar "Comprada" e liberar o download direto).
export function useOwned() {
  const { user } = useSite();
  const [owned, setOwned] = useState(new Set());
  useEffect(() => {
    if (!user) return setOwned(new Set());
    api('/my/photos').then((d) => setOwned(new Set(d.photos.map((p) => p.id)))).catch(() => {});
  }, [user]);
  return owned;
}

// Evento com senha: pede a senha antes de mostrar fotos e busca por selfie.
function LockedEvent({ event, onUnlock }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api(`/events/${event.slug}/unlock`, { method: 'POST', body: { password: pw } });
      onUnlock();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="container section" style={{ maxWidth: 560 }}>
      <form className="card stack" style={{ padding: 28, gap: 16 }} onSubmit={submit}>
        <Lock size={26} color="var(--accent)" />
        <h1 style={{ fontSize: 'clamp(30px, 4vw, 42px)' }}>{event.title}</h1>
        <span className="small muted">{dateBR(event.event_date)}{event.city ? ` · ${event.city}` : ''} · {plural(event.photo_count, 'foto', 'fotos')}</span>
        <p className="muted">Este evento é reservado. Digite a senha que você recebeu junto com o link para ver as fotos.</p>
        <label className="field"><span>Senha do evento</span><input className="input" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus autoComplete="off" /></label>
        {err && <div className="alert alert-bad">{err}</div>}
        <button className="btn btn-accent" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Conferindo…' : 'Entrar no evento'}</button>
      </form>
    </div>
  );
}

export default function EventPage() {
  const { slug } = useParams();
  const { toast } = useSite();
  const { items } = useCart();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState(null);
  const [photos, setPhotos] = useState({ list: [], more: false, loading: true });
  const [tab, setTab] = useState('todas');
  const [mine, setMine] = useState(null); // resultado da busca facial
  const [searching, setSearching] = useState(false);
  const [hours, setHours] = useState([]);
  const [hour, setHour] = useState(null);
  const owned = useOwned();
  useTitle(event?.title);

  useEffect(() => {
    setEvent(null);
    setMine(null);
    setTab('todas');
    api(`/events/${slug}`).then((d) => setEvent(d.event)).catch(setError);
    api(`/events/${slug}/photos?limit=200`).then((d) => setPhotos({ list: d.photos, more: d.more, loading: false, hidden: !!d.hidden, owner: !!d.owner })).catch(() => setPhotos({ list: [], more: false, loading: false }));
    setHour(null);
    api(`/events/${slug}/hours`).then((d) => setHours(d.hours || [])).catch(() => setHours([]));
  }, [slug]);

  // Filtro por horario: recarrega a galeria so com as fotos daquela hora.
  const pickHour = (h) => {
    setHour(h);
    setPhotos((p) => ({ ...p, loading: true }));
    api(`/events/${slug}/photos?limit=200${h == null ? '' : `&hour=${h}`}`).then((d) => setPhotos((p) => ({ ...p, list: d.photos, more: d.more, loading: false }))).catch(() => setPhotos((p) => ({ ...p, loading: false })));
  };

  const eventInfo = useMemo(() => (event ? { event_title: event.title, event_slug: event.slug, price_cents: event.price_cents } : {}), [event]);

  const loadMore = async () => {
    const d = await api(`/events/${slug}/photos?limit=200&offset=${photos.list.length}${hour == null ? '' : `&hour=${hour}`}`);
    setPhotos((p) => ({ list: [...p.list, ...d.photos], more: d.more, loading: false }));
  };

  const search = async (selfie) => {
    setSearching(true);
    try {
      const d = await api('/faces/search', { method: 'POST', body: { descriptors: [selfie.descriptor], scope: 'event', event: slug } });
      setMine(d.photos);
      setTab('minhas');
    } catch (err) {
      toast(err.message);
    } finally {
      setSearching(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) navigator.share({ title: event.title, url }).catch(() => {});
    else {
      await navigator.clipboard?.writeText(url);
      toast('Link copiado!');
    }
  };

  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  if (!event) return <Loading />;
  if (event.locked) return <LockedEvent event={event} onUnlock={() => {
    api(`/events/${slug}`).then((d) => setEvent(d.event)).catch(setError);
    api(`/events/${slug}/photos?limit=200`).then((d) => setPhotos({ list: d.photos, more: d.more, loading: false, hidden: !!d.hidden, owner: !!d.owner })).catch(() => {});
  }} />;

  const inThisEvent = items.filter((i) => i.event_slug === event.slug).length;
  const hidden = photos.hidden;
  const shown = tab === 'minhas' ? mine || [] : photos.list;

  return (
    <div className="container section-sm stack" style={{ gap: 28 }}>
      <div className="event-head">
        <div className="cover">{event.cover ? <img src={event.cover} alt="" /> : <div className="placeholder-cover"><Camera size={40} strokeWidth={1.2} /></div>}</div>
        <div className="stack">
          {event.category_name && <Link to={`/categoria/${event.category_slug}`} className="eyebrow">{event.category_name}</Link>}
          <h1 style={{ fontSize: 'clamp(28px,4vw,42px)' }}>{event.title}</h1>
          <div className="event-meta" style={{ fontSize: 15 }}>
            <span className="row" style={{ gap: 5 }}><Calendar size={15} /> {dateBR(event.event_date, true)}</span>
            {(event.venue || event.city) && <span className="row" style={{ gap: 5 }}><MapPin size={15} /> {[event.venue, event.city].filter(Boolean).join(' · ')}</span>}
          </div>
          {event.photographer_name && (
            <Link to={`/fotografo/${event.photographer_slug}`} className="row small" style={{ gap: 8 }}>
              {event.photographer_avatar ? <img src={event.photographer_avatar} alt="" style={{ width: 28, height: 28, borderRadius: 99 }} /> : <Camera size={16} />}
              Fotos por <b>{event.photographer_name}</b>
            </Link>
          )}
          {event.description && <p className="muted">{event.description}</p>}
          <PriceSummary event={event} />
          <div className="row">
            <span className="small muted">{plural(event.photo_count, 'foto', 'fotos')}</span>
            <button className="btn btn-sm btn-ghost" onClick={share}><Share2 size={15} /> Compartilhar</button>
          </div>
        </div>
      </div>

      {event.photo_count > 0 && (
        event.face_count > 0 ? (
          <SelfieSearch onSelfie={search} busy={searching} title="Ache suas fotos neste evento" subtitle={event.hide_gallery ? 'As fotos deste evento são protegidas. Tire uma selfie para ver as suas.' : 'Tire uma selfie e mostramos só as fotos em que você aparece neste evento.'} />
        ) : (
          <div className="alert">Este evento ainda não tem reconhecimento facial: navegue pelas fotos abaixo.</div>
        )
      )}

      <div className="stack">
        <div className="tabs">
          {!hidden && <button className={tab === 'todas' ? 'active' : ''} onClick={() => setTab('todas')}>Todas as fotos ({event.photo_count})</button>}
          {mine && <button className={tab === 'minhas' ? 'active' : ''} onClick={() => setTab('minhas')}><ScanFace size={15} style={{ verticalAlign: -2 }} /> Minhas fotos ({mine.length})</button>}
        </div>
        {tab === 'minhas' && mine && (
          mine.length ? (
            <div className="stack" style={{ gap: 10 }}>
              <span className="small muted">Encontramos {plural(mine.length, 'foto', 'fotos')} com você. Confira abaixo.</span>
              <BuyAll photos={mine.filter((p) => !owned.has(p.id)).map((p) => ({ ...p, ...eventInfo }))} />
            </div>
          ) : (
            <Empty icon={ScanFace} title="Não encontramos você neste evento">Tente uma selfie mais de frente e com boa luz, ou procure nas fotos.</Empty>
          )
        )}
        {hidden && tab === 'todas' && (
          <div className="hidden-gallery">
            <Lock size={28} />
            <b>Fotos protegidas</b>
            <p className="muted small" style={{ maxWidth: 460 }}>Neste evento as fotos não ficam expostas: cada pessoa vê só as fotos em que aparece. Tire uma selfie acima para encontrar as suas entre as {event.photo_count} fotos.</p>
            {photos.owner && <p className="small" style={{ maxWidth: 460 }}>Você está logado como responsável pelo evento e vê esta página igual a um visitante. <Link to={`/painel/eventos/${event.id}`} style={{ textDecoration: 'underline' }}>Ver e gerenciar as fotos no painel</Link></p>}
          </div>
        )}
        {tab === 'todas' && !hidden && hours.length > 1 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="tiny muted">Lembra mais ou menos a hora? Filtre pelas fotos daquele horário.</span>
            <div className="chips">
              <button className={`chip${hour == null ? ' active' : ''}`} onClick={() => pickHour(null)}>Todos os horários</button>
              {hours.map((x) => (
                <button key={x.hour} className={`chip${hour === x.hour ? ' active' : ''}`} onClick={() => pickHour(x.hour)}>{String(x.hour).padStart(2, '0')}h <em>{x.photos}</em></button>
              ))}
            </div>
          </div>
        )}
        {photos.loading ? <Loading /> : shown.length > 0 && <PhotoGrid photos={shown} owned={owned} eventInfo={eventInfo} />}
        {tab === 'todas' && photos.more && <div className="center"><button className="btn btn-ghost" onClick={loadMore}>Carregar mais fotos</button></div>}
        {!photos.loading && event.photo_count === 0 && <Empty title="Fotos chegando em breve">O fotógrafo ainda está publicando as fotos deste evento.</Empty>}
      </div>

      {inThisEvent > 0 && (
        <div className="sticky-bar">
          <span className="small"><b>{inThisEvent}</b> {inThisEvent === 1 ? 'foto selecionada' : 'fotos selecionadas'}</span>
          <Link to="/carrinho" className="btn btn-accent btn-sm">Ver carrinho</Link>
        </div>
      )}
    </div>
  );
}
