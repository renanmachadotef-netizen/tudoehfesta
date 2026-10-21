import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, X, Calendar, MapPin, Images, ShoppingBag, Camera } from 'lucide-react';
import { cart, useCart } from '../lib/cart.js';
import { dateBR, money } from '../lib/format.js';

export function EventCard({ event, to }) {
  return (
    <Link to={to || `/evento/${event.slug}`} className="event-card">
      <div className="event-cover">
        {event.cover_thumb ? (
          <img src={event.cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="placeholder-cover"><Camera size={30} strokeWidth={1.5} /></div>
        )}
        {event.category_name && <span className="badge">{event.category_name}</span>}
        {event.photo_count > 0 && <span className="badge count"><Images size={12} /> {event.photo_count}</span>}
      </div>
      <div>
        <div className="event-title">{event.title}</div>
        <div className="event-meta" style={{ marginTop: 4 }}>
          <span className="row" style={{ gap: 4 }}><Calendar size={13} /> {dateBR(event.event_date)}</span>
          {event.city && <span className="row" style={{ gap: 4 }}><MapPin size={13} /> {event.city}</span>}
        </div>
        {event.photographer_name && <div className="tiny muted" style={{ marginTop: 2 }}>por {event.photographer_name}</div>}
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
          <div className="skeleton" style={{ height: 16, width: '70%', borderRadius: 6 }} />
        </div>
      ))}
    </div>
  );
}

// Grade justificada: cada foto ocupa largura proporcional a sua proporcao, linhas com altura ~ uniforme.
export function PhotoGrid({ photos, rowHeight = 220, owned, eventInfo }) {
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
              className={`jitem${selected ? ' selected' : ''}${isOwned ? ' owned' : ''}`}
              style={{ flexGrow: ratio, flexBasis: `${ratio * h}px`, aspectRatio: ratio }}
              onClick={() => setOpen(i)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <img src={p.thumb} alt="" loading="lazy" decoding="async" draggable="false" />
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
