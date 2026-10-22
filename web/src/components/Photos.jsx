import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, X, Clock, MapPin, ShoppingBag, Camera } from 'lucide-react';
import { cart, useCart } from '../lib/cart.js';
import { dateWeekBR, money } from '../lib/format.js';

export function EventCard({ event, to }) {
  return (
    <Link to={to || `/evento/${event.slug}`} className="event-card">
      <div className="event-cover">
        {event.cover_thumb ? (
          <img src={event.cover_thumb} srcSet={`${event.cover_thumb} 480w, ${event.cover} 1400w`} sizes="(max-width: 560px) 100vw, 300px" alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="placeholder-cover"><Camera size={30} strokeWidth={1.5} /></div>
        )}
      </div>
      <div className="event-body">
        <div className="event-title" title={event.title}>{event.title}</div>
        {(event.venue || event.city) && (
          <div className="event-meta"><MapPin size={16} /><span>{[event.venue, event.city].filter(Boolean).join(' • ')}</span></div>
        )}
        <div className="event-meta"><Clock size={16} /><span>{dateWeekBR(event.event_date)}</span></div>
      </div>
    </Link>
  );
}

export function EventGridSkeleton({ n = 8 }) {
  return (
    <div className="events-grid">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="event-card">
          <div className="event-cover skeleton" />
          <div className="event-body"><div className="skeleton" style={{ height: 16, width: '70%', borderRadius: 6 }} /></div>
        </div>
      ))}
    </div>
  );
}

// Grade justificada: cada foto ocupa largura proporcional a sua proporcao, linhas com altura ~ uniforme.
export function PhotoGrid({ photos, rowHeight = 220, owned, eventInfo, picked, onPick }) {
  const { items } = useCart();
  const inCart = new Set(items.map((i) => i.id));
  const [open, setOpen] = useState(-1);
  const h = typeof window !== 'undefined' && window.innerWidth < 600 ? Math.round(rowHeight * 0.62) : rowHeight;

  return (
    <>
      <div className="jgrid no-save">
        {photos.map((p, i) => {
          const ratio = p.w && p.h ? p.w / p.h : 1.5;
          const selected = inCart.has(p.id);
          const isOwned = owned?.has(p.id);
          return (
            <div
              key={p.id}
              className={`jitem${selected ? ' selected' : ''}${isOwned ? ' owned' : ''}${picked?.has(p.id) ? ' picked' : ''}`}
              style={{ flexGrow: ratio, flexBasis: `${ratio * h}px`, aspectRatio: ratio }}
              onClick={() => setOpen(i)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <img src={p.thumb} alt="" loading="lazy" decoding="async" draggable="false" />
              {onPick && (
                <button
                  className="me"
                  aria-pressed={picked?.has(p.id) || false}
                  title="Marque as fotos em que você aparece: elas ajudam a achar fotos de outras épocas"
                  onClick={(e) => { e.stopPropagation(); onPick(p); }}
                >
                  {picked?.has(p.id) ? <><Check size={13} strokeWidth={3} /> Sou eu</> : 'Sou eu?'}
                </button>
              )}
              {!isOwned && (
                <button
                  className="sel"
                  aria-label={selected ? 'Tirar do carrinho' : 'Adicionar ao carrinho'}
                  onClick={(e) => {
                    e.stopPropagation();
                    cart.toggle({ ...p, ...eventInfo });
                  }}
                >
                  {selected ? <Check size={16} strokeWidth={3} /> : <ShoppingBag size={14} />}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {open >= 0 && (
        <Lightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(-1)} owned={owned} eventInfo={eventInfo} />
      )}
    </>
  );
}

export function Lightbox({ photos, index, onIndex, onClose, owned, eventInfo }) {
  const p = photos[index];
  const { items } = useCart();
  const selected = items.some((i) => i.id === p?.id);
  const go = useCallback((d) => onIndex((i) => Math.min(photos.length - 1, Math.max(0, i + d))), [onIndex, photos.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [go, onClose]);

  // Gesto de arrastar no celular.
  const [touchX, setTouchX] = useState(null);
  if (!p) return null;
  const next = photos[index + 1];
  const info = { ...p, ...eventInfo };

  return (
    <div className="lightbox" role="dialog" aria-modal="true">
      <div className="lightbox-top">
        <span className="small" style={{ opacity: 0.7 }}>
          {index + 1} de {photos.length}
          {p.event_title && <> · {p.event_title}</>}
        </span>
        <button className="icon-btn" style={{ color: '#fff' }} onClick={onClose} aria-label="Fechar"><X size={22} /></button>
      </div>
      <div
        className="lightbox-stage no-save"
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX == null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          setTouchX(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <img key={p.id} src={p.preview} alt="" draggable="false" />
        {next && <link rel="prefetch" href={next.preview} />}
        {index > 0 && <button className="icon-btn nav-btn hide-sm" style={{ left: 12 }} onClick={() => go(-1)} aria-label="Anterior"><ChevronLeft /></button>}
        {index < photos.length - 1 && <button className="icon-btn nav-btn hide-sm" style={{ right: 12 }} onClick={() => go(1)} aria-label="Próxima"><ChevronRight /></button>}
      </div>
      <div className="lightbox-bottom">
        {owned?.has(p.id) ? (
          <a className="btn btn-light" href={`/api/download/${p.id}`}>Baixar em alta resolução</a>
        ) : (
          <>
            {p.price_cents && <b>{money(p.price_cents)}</b>}
            <button className={`btn ${selected ? 'btn-light' : 'btn-accent'}`} onClick={() => cart.toggle(info)}>
              {selected ? <><Check size={17} /> No carrinho</> : <><ShoppingBag size={17} /> Adicionar ao carrinho</>}
            </button>
            {items.length > 0 && <Link to="/carrinho" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.3)' }}>Ver carrinho ({items.length})</Link>}
          </>
        )}
      </div>
    </div>
  );
}
