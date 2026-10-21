import { Link, useParams } from 'react-router-dom';
import { Camera, MapPin, AtSign, MessageCircle } from 'lucide-react';
import { useApi, useTitle } from '../lib/site.jsx';
import { plural } from '../lib/format.js';
import { Loading, Empty, ErrorBox } from '../components/Layout.jsx';
import { EventCard } from '../components/Photos.jsx';

function Avatar({ src, size = 64 }) {
  return src ? (
    <img src={src} alt="" style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover' }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: 999, background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }}><Camera size={size / 2.6} /></div>
  );
}

function Profile({ slug }) {
  const { data, loading, error } = useApi(`/photographers/${slug}`);
  useTitle(data?.photographer?.display_name);
  if (loading) return <Loading />;
  if (error) return <div className="container section"><ErrorBox error={error} /></div>;
  const p = data.photographer;
  return (
    <div className="container section-sm stack" style={{ gap: 28 }}>
      <div className="row" style={{ gap: 20 }}>
        <Avatar src={p.avatar_path} size={96} />
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 'clamp(26px,4vw,38px)' }}>{p.display_name}</h1>
          <div className="row small muted">
            {p.city && <span className="row" style={{ gap: 4 }}><MapPin size={14} /> {p.city}</span>}
            {p.instagram && <a className="row" style={{ gap: 4 }} href={`https://instagram.com/${p.instagram}`} target="_blank" rel="noreferrer"><AtSign size={14} /> {p.instagram}</a>}
            {p.whatsapp && <a className="row" style={{ gap: 4 }} href={`https://wa.me/55${p.whatsapp.replace(/\D/g, '').replace(/^55/, '')}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Contratar</a>}
          </div>
          {p.bio && <p className="muted" style={{ maxWidth: 640 }}>{p.bio}</p>}
        </div>
      </div>
      <h2>Eventos</h2>
      {data.events.length ? <div className="events-grid">{data.events.map((e) => <EventCard key={e.id} event={e} />)}</div> : <Empty title="Nenhum evento publicado ainda" />}
    </div>
  );
}

export default function Photographers() {
  const { slug } = useParams();
  const list = useApi(slug ? null : '/photographers');
  useTitle(slug ? '' : 'Fotógrafos');
  if (slug) return <Profile slug={slug} />;
  return (
    <div className="container section-sm stack" style={{ gap: 24 }}>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Parceiros</span>
          <h1 style={{ fontSize: 'clamp(28px,4vw,40px)' }}>Fotógrafos da região</h1>
        </div>
        <Link to="/seja-fotografo" className="btn btn-sm btn-ghost">Seja um parceiro</Link>
      </div>
      {list.loading ? <Loading /> : (
        <div className="events-grid">
          {(list.data?.photographers || []).map((p) => (
            <Link key={p.slug} to={`/fotografo/${p.slug}`} className="card row" style={{ gap: 14, flexWrap: 'nowrap' }}>
              <Avatar src={p.avatar_path} />
              <div style={{ minWidth: 0 }}>
                <b>{p.display_name}</b>
                <div className="small muted">{p.city}</div>
                <div className="tiny muted">{plural(p.events, 'evento', 'eventos')} · {plural(p.photos, 'foto', 'fotos')}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
