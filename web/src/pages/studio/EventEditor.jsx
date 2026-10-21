import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Upload, Trash2, Star, ScanFace, Plus, X, ExternalLink, Copy, Download, MessageCircle, ArrowLeft } from 'lucide-react';
import { api, uploadWithProgress } from '../../lib/api.js';
import { useSite } from '../../lib/site.jsx';
import { centsToInput, money } from '../../lib/format.js';
import { detectFaces, fileToCanvas, loadFaceApi } from '../../lib/faces.js';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import { EVENT_STATUS } from './EventsList.jsx';

const blank = { title: '', event_date: new Date().toISOString().slice(0, 10), category_id: '', city: '', venue: '', description: '', price: '15,00', pack_price: '', discount_tiers: [{ min: 5, pct: 20 }], status: 'draft' };

function EventForm({ initial, onSaved }) {
  const { categories = [], toast } = useSite();
  const [f, setF] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setTier = (i, k, v) => setF({ ...f, discount_tiers: f.discount_tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...f, discount_tiers: f.discount_tiers.filter((t) => t.min && t.pct) };
      const d = initial.id ? await api(`/studio/events/${initial.id}`, { method: 'PUT', body }) : await api('/studio/events', { method: 'POST', body });
      toast('Evento salvo');
      onSaved?.(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <label className="field"><span>Nome do evento</span><input className="input" required value={f.title} onChange={set('title')} placeholder="Ex.: Formatura Medicina UNESC 2026" /></label>
      <div className="grid-3">
        <label className="field"><span>Data</span><input className="input" type="date" required value={f.event_date} onChange={set('event_date')} /></label>
        <label className="field"><span>Categoria</span>
          <select className="select" value={f.category_id || ''} onChange={set('category_id')}>
            <option value="">Escolha…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Status</span>
          <select className="select" value={f.status} onChange={set('status')}>
            <option value="draft">Rascunho (só você vê)</option>
            <option value="published">Publicado</option>
            <option value="hidden">Oculto</option>
          </select>
        </label>
      </div>
      <div className="grid-2">
        <label className="field"><span>Cidade</span><input className="input" value={f.city || ''} onChange={set('city')} placeholder="Araranguá, SC" /></label>
        <label className="field"><span>Local</span><input className="input" value={f.venue || ''} onChange={set('venue')} placeholder="Ex.: Caverá Country Park" /></label>
      </div>
      <label className="field"><span>Descrição <small>(opcional)</small></span><textarea className="textarea" value={f.description || ''} onChange={set('description')} /></label>

      <div className="card-flat stack">
        <b>Preços</b>
        <div className="grid-2">
          <label className="field"><span>Preço por foto (R$)</span><input className="input" required inputMode="decimal" value={f.price} onChange={set('price')} /></label>
          <label className="field"><span>Pacote: teto por cliente (R$) <small>opcional</small></span><input className="input" inputMode="decimal" value={f.pack_price || ''} onChange={set('pack_price')} placeholder="Ex.: 120,00" /><small>Quem comprar muitas fotos deste evento paga no máximo esse valor.</small></label>
        </div>
        <span className="field"><span>Desconto progressivo</span></span>
        {f.discount_tiers.map((t, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
            <span className="small">A partir de</span>
            <input className="input" style={{ width: 80 }} type="number" min="2" value={t.min} onChange={(e) => setTier(i, 'min', e.target.value)} />
            <span className="small">fotos,</span>
            <input className="input" style={{ width: 80 }} type="number" min="1" max="90" value={t.pct} onChange={(e) => setTier(i, 'pct', e.target.value)} />
            <span className="small">% off</span>
            <button type="button" className="icon-btn" onClick={() => setF({ ...f, discount_tiers: f.discount_tiers.filter((_, j) => j !== i) })} aria-label="Remover faixa"><X size={16} /></button>
          </div>
        ))}
        {f.discount_tiers.length < 6 && (
          <button type="button" className="btn btn-soft btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, discount_tiers: [...f.discount_tiers, { min: (Number(f.discount_tiers.at(-1)?.min) || 0) + 5, pct: (Number(f.discount_tiers.at(-1)?.pct) || 0) + 10 }] })}>
            <Plus size={14} /> Adicionar faixa
          </button>
        )}
      </div>
      {error && <div className="alert alert-bad">{error}</div>}
      <button className="btn btn-accent" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Salvando…' : initial.id ? 'Salvar alterações' : 'Criar evento e enviar fotos'}</button>
    </form>
  );
}

// Fila de upload: analisa rostos no navegador (uma foto por vez, usa a GPU) e envia ate 3 em paralelo.
function Uploader({ eventId, onUploaded }) {
  const [useFaces, setUseFaces] = useState(true);
  const [drag, setDrag] = useState(false);
  const [st, setSt] = useState(null);
  const cancel = useRef(false);
  const input = useRef();
  const running = st && !st.finished;

  useEffect(() => {
    if (!running) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const start = async (fileList) => {
    const files = [...fileList].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type)).sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
    if (!files.length) return;
    cancel.current = false;
    const s = { total: files.length, done: 0, failed: 0, dup: 0, faces: 0, status: '', errors: [], finished: false };
    const push = (patch) => setSt((cur) => ({ ...(cur || s), ...patch(cur || s) }));
    setSt(s);
    if (useFaces) {
      try {
        await loadFaceApi((m) => push(() => ({ status: m })));
      } catch {
        push(() => ({ status: 'Reconhecimento facial indisponível neste navegador: enviando sem rostos.' }));
      }
    }
    const inflight = new Set();
    for (const file of files) {
      if (cancel.current) break;
      let faces = [];
      if (useFaces) {
        push(() => ({ status: `Analisando rostos: ${file.name}` }));
        try {
          faces = await detectFaces(await fileToCanvas(file, 1400));
        } catch { /* foto sem rosto detectavel */ }
      }
      while (inflight.size >= 3) await Promise.race(inflight);
      const form = new FormData();
      form.append('faces', JSON.stringify(faces.map(({ d, box }) => ({ d, box }))));
      form.append('name', file.name);
      form.append('sort_key', file.name);
      form.append('file', file);
      const p = uploadWithProgress(`/studio/events/${eventId}/photos`, form)
        .then((d) => {
          if (d.duplicate) push((c) => ({ dup: c.dup + 1, done: c.done + 1 }));
          else {
            push((c) => ({ done: c.done + 1, faces: c.faces + (d.photo?.faces || 0) }));
            onUploaded?.(d.photo);
          }
        })
        .catch((err) => push((c) => ({ failed: c.failed + 1, done: c.done + 1, errors: [...c.errors, `${file.name}: ${err.message}`].slice(-5) })))
        .finally(() => inflight.delete(p));
      inflight.add(p);
    }
    await Promise.all(inflight);
    push(() => ({ finished: true, status: cancel.current ? 'Envio interrompido.' : 'Envio concluído!' }));
  };

  const pct = st ? Math.round((st.done / st.total) * 100) : 0;

  return (
    <div className="card stack">
      <div className="row between"><h3>Enviar fotos</h3>
        <label className="check" style={{ alignItems: 'center' }}><input type="checkbox" checked={useFaces} disabled={running} onChange={(e) => setUseFaces(e.target.checked)} /> <ScanFace size={16} /> Reconhecimento facial</label>
      </div>
      {!running && (
        <div
          className={`upload-drop${drag ? ' drag' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); start(e.dataTransfer.files); }}
        >
          <Upload size={28} style={{ margin: '0 auto 8px' }} />
          <b>Arraste as fotos aqui ou clique para escolher</b>
          <p className="small muted">JPG, PNG ou WEBP. Pode selecionar centenas de uma vez. Repetidas são ignoradas.</p>
          <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { start(e.target.files); e.target.value = ''; }} />
        </div>
      )}
      {st && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
          <div className="row between small">
            <span>{st.done} de {st.total} · <ScanFace size={13} style={{ verticalAlign: -2 }} /> {st.faces} rostos{st.dup ? ` · ${st.dup} repetidas` : ''}{st.failed ? ` · ${st.failed} com erro` : ''}</span>
            {running ? <button className="btn btn-sm btn-danger" onClick={() => { cancel.current = true; }}>Parar</button> : <button className="btn btn-sm btn-soft" onClick={() => setSt(null)}>Enviar mais</button>}
          </div>
          <span className="tiny muted">{st.status}{running && ' · Mantenha esta aba aberta até terminar.'}</span>
          {st.errors.map((e) => <span key={e} className="tiny" style={{ color: 'var(--bad)' }}>{e}</span>)}
        </div>
      )}
    </div>
  );
}

function ShareKit({ event }) {
  const { toast } = useSite();
  const [qr, setQr] = useState('');
  const url = `${window.location.origin}/evento/${event.slug}`;
  useEffect(() => {
    import('qrcode').then((m) => m.default.toDataURL(url, { width: 640, margin: 1, color: { dark: '#0e0d0c' } })).then(setQr).catch(() => {});
  }, [url]);
  const text = `📸 As fotos do ${event.title} já estão no ar! Tire uma selfie e ache as suas: ${url}`;
  return (
    <div className="card stack">
      <h3>Divulgação</h3>
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        {qr && <img src={qr} alt="QR Code do evento" className="qr" style={{ width: 160, height: 160 }} />}
        <div className="stack grow" style={{ minWidth: 220 }}>
          <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} />
          <div className="row">
            <button className="btn btn-sm btn-soft" onClick={async () => { await navigator.clipboard?.writeText(url); toast('Link copiado'); }}><Copy size={14} /> Copiar link</button>
            <a className="btn btn-sm btn-soft" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>
            {qr && <a className="btn btn-sm btn-soft" href={qr} download={`qrcode-${event.slug}.png`}><Download size={14} /> QR Code</a>}
            <a className="btn btn-sm btn-soft" href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Ver página</a>
          </div>
          <span className="tiny muted">Coloque o QR Code no telão, no flyer ou na mesa do evento: quem escanear cai direto na busca por selfie.</span>
        </div>
      </div>
    </div>
  );
}

function PhotosManager({ event, photos, setPhotos, onCover }) {
  const { toast } = useSite();
  const del = async (p) => {
    if (!confirm('Excluir esta foto?')) return;
    try {
      await api(`/studio/photos/${p.id}`, { method: 'DELETE' });
      setPhotos((list) => list.filter((x) => x.id !== p.id));
    } catch (err) {
      toast(err.message);
    }
  };
  const cover = async (p) => {
    await api(`/studio/events/${event.id}/cover`, { method: 'PUT', body: { photoId: p.id } });
    onCover(p.id);
    toast('Capa definida');
  };
  if (!photos.length) return null;
  const noFaces = photos.filter((p) => !p.faces).length;
  return (
    <div className="card stack">
      <div className="row between"><h3>Fotos ({photos.length})</h3><span className="small muted">{noFaces} sem rosto detectado</span></div>
      <div className="studio-photos">
        {photos.map((p) => (
          <div key={p.id} className="studio-photo">
            <img src={p.thumb} alt="" loading="lazy" />
            <div className="acts">
              <button title="Usar como capa" onClick={() => cover(p)}><Star size={14} fill={event.cover_photo_id === p.id ? '#ffb21a' : 'none'} /></button>
              {!p.sold && <button title="Excluir" onClick={() => del(p)}><Trash2 size={14} /></button>}
            </div>
            <div className="ov">
              <span className="badge" style={{ background: 'rgba(255,255,255,.9)' }}><ScanFace size={11} /> {p.faces || 0}</span>
              {p.sold > 0 && <span className="badge badge-ok">{p.sold} venda(s)</span>}
              {event.cover_photo_id === p.id && <span className="badge badge-accent">Capa</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EventEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast, refresh } = useSite();
  const [event, setEvent] = useState(id ? null : blank);
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) { setEvent(blank); setPhotos([]); return; }
    api(`/studio/events/${id}`).then((d) => setEvent(d.event)).catch(setError);
    api(`/studio/events/${id}/photos`).then((d) => setPhotos(d.photos)).catch(() => {});
  }, [id]);

  if (error) return <ErrorBox error={error} />;
  if (!event) return <Loading />;

  const initial = event.id ? {
    id: event.id, title: event.title, event_date: event.event_date, category_id: event.category_id || '', city: event.city, venue: event.venue,
    description: event.description, price: centsToInput(event.price_cents), pack_price: centsToInput(event.pack_price_cents),
    discount_tiers: event.discount_tiers || [], status: event.status,
  } : blank;

  const remove = async () => {
    if (!confirm('Excluir o evento e todas as fotos? Isso não pode ser desfeito.')) return;
    try {
      await api(`/studio/events/${event.id}`, { method: 'DELETE' });
      toast('Evento excluído');
      nav('/painel/eventos');
    } catch (err) {
      toast(err.message);
    }
  };

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 1000 }}>
      <div className="row between">
        <div className="row">
          <Link to="/painel/eventos" className="icon-btn" aria-label="Voltar"><ArrowLeft size={18} /></Link>
          <h2>{event.id ? event.title : 'Novo evento'}</h2>
          {event.id && <span className={`badge ${EVENT_STATUS[event.status][1]}`}>{EVENT_STATUS[event.status][0]}</span>}
        </div>
        {event.id && <span className="small muted">{money(event.price_cents)}/foto · {event.photo_count} fotos · {event.face_count} rostos</span>}
      </div>

      {event.id && event.status !== 'published' && photos.length > 0 && (
        <div className="alert alert-warn">Este evento ainda não aparece no site. Mude o status para <b>Publicado</b> quando terminar de enviar.</div>
      )}

      {event.id && <Uploader eventId={event.id} onUploaded={(p) => p && setPhotos((list) => [...list, { ...p, sold: 0 }])} />}

      <EventForm
        key={event.id || 'novo'}
        initial={initial}
        onSaved={async (d) => {
          await refresh();
          if (!event.id && d.event) nav(`/painel/eventos/${d.event.id}`, { replace: true });
          else api(`/studio/events/${event.id}`).then((x) => setEvent(x.event));
        }}
      />

      {event.id && <PhotosManager event={event} photos={photos} setPhotos={setPhotos} onCover={(pid) => setEvent({ ...event, cover_photo_id: pid })} />}
      {event.id && event.status === 'published' && <ShareKit event={event} />}
      {event.id && <button className="btn btn-danger btn-sm" style={{ alignSelf: 'flex-start' }} onClick={remove}><Trash2 size={14} /> Excluir evento</button>}
    </div>
  );
}
