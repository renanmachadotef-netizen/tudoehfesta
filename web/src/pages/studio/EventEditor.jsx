import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Upload, Trash2, Star, ScanFace, Plus, X, ExternalLink, Copy, Download, MessageCircle, ArrowLeft, EyeOff, Eye, HardDrive, RefreshCw } from 'lucide-react';
import { api, uploadWithProgress } from '../../lib/api.js';
import { useSite } from '../../lib/site.jsx';
import { centsToInput, money, dateBR, dateTimeBR } from '../../lib/format.js';
import { detectFaces, fileToCanvas, loadFaceApi } from '../../lib/faces.js';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import { EVENT_STATUS } from './EventsList.jsx';
import EventDrive from './EventDrive.jsx';
import DisplaySelect from '../../components/DisplaySelect.jsx';
import EventInsights from './EventInsights.jsx';
import ArtEditor from './ArtEditor.jsx';
import EventTeam from './EventTeam.jsx';
import { EventCard } from '../../components/Photos.jsx';

const blank = { title: '', event_date: new Date().toISOString().slice(0, 10), category_id: '', city: '', venue: '', description: '', price: '15,00', pack_price: '', discount_tiers: [{ min: 5, pct: 20 }], status: 'draft', hide_gallery: false, watermark_mode: 'site', visibility: 'public', password: '', publish_at: '', protect_mode: 'none', bib_search: false, accepts_partners: false };
// Data e hora de Brasilia para o campo datetime-local (o servidor guarda com fuso).
const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 16) : '');

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
      {f.status === 'draft' && (
        <label className="field"><span>Publicar automaticamente em <small>(opcional)</small></span>
          <input className="input" type="datetime-local" value={f.publish_at || ''} onChange={set('publish_at')} style={{ maxWidth: 260 }} />
          <small>O evento vai ao ar sozinho nessa data e hora (horário de Brasília). Bom para liberar as fotos no dia seguinte da festa.</small>
        </label>
      )}
      <div className="grid-2">
        <label className="field"><span>Quem pode abrir o evento</span>
          <select className="select" value={f.visibility || 'public'} onChange={set('visibility')}>
            <option value="public">Público · aparece nas listas do site</option>
            <option value="unlisted">Só quem tiver o link · fora das listas</option>
            <option value="password">Com senha · pede senha para ver</option>
          </select>
          <small>{f.visibility === 'password' ? 'Fica fora das listas e da busca geral por selfie; a pessoa digita a senha na página do evento.' : f.visibility === 'unlisted' ? 'Não aparece em listas nem na página inicial, mas quem tem o link entra normalmente.' : 'Aparece na lista de eventos, na categoria e no ano.'}</small>
        </label>
        {f.visibility === 'password' && (
          <label className="field"><span>Senha do evento</span>
            <input className="input" value={f.password || ''} onChange={set('password')} placeholder={initial.has_password ? 'Deixe em branco para manter a atual' : 'Ex.: FORMATURA26'} autoComplete="off" />
            <small>Passe a senha para os convidados junto com o link.</small>
          </label>
        )}
      </div>
      <div className="grid-2">
        <label className="field"><span>Cidade</span><input className="input" value={f.city || ''} onChange={set('city')} placeholder="Araranguá, SC" /></label>
        <label className="field"><span>Local</span><input className="input" value={f.venue || ''} onChange={set('venue')} placeholder="Ex.: Caverá Country Park" /></label>
      </div>
      <label className="field"><span>Descrição <small>(opcional)</small></span><textarea className="textarea" value={f.description || ''} onChange={set('description')} /></label>

      <div className="grid-2">
        <label className="field"><span>Marca d’água</span>
          <select className="select" value={f.watermark_mode} onChange={set('watermark_mode')}>
            <option value="site">Padrão do site</option>
            <option value="photographer">Minha marca</option>
            <option value="none">Sem marca d’água</option>
          </select>
          <small>Trocar refaz as vitrines em segundo plano. <Link to="/painel/marca-dagua" style={{ textDecoration: 'underline' }}>Configurar minha marca</Link></small>
        </label>
        <div className="field"><span>Como os clientes encontram as fotos</span>
          <label className="check"><input type="radio" name="visibilidade" checked={!f.hide_gallery} onChange={() => setF({ ...f, hide_gallery: false })} /><span><b>Mostrar todas as fotos</b> <span className="muted">· galeria aberta + busca por selfie</span></span></label>
          <label className="check"><input type="radio" name="visibilidade" checked={!!f.hide_gallery} onChange={() => setF({ ...f, hide_gallery: true })} /><span><b><EyeOff size={14} style={{ verticalAlign: -2 }} /> Só por reconhecimento facial</b> <span className="muted">· cada pessoa vê só as fotos em que aparece</span></span></label>
        </div>
      </div>
      <div className="grid-2">
        <label className="field"><span>Proteção da prévia</span>
          <select className="select" value={f.protect_mode || 'none'} onChange={set('protect_mode')}>
            <option value="none">Sem desfoque · só a marca d’água</option>
            <option value="circle">Círculo nítido no centro</option>
            <option value="band">Faixa nítida no meio</option>
            <option value="diagonal">Diagonal nítida</option>
            <option value="vertical">Metade vertical nítida</option>
            <option value="horizontal">Metade horizontal nítida</option>
          </select>
          <small>A foto ampliada aparece desfocada fora da área escolhida: dá para se reconhecer, mas um print não substitui a compra. Quem compra recebe a original inteira. Trocar refaz as prévias.</small>
        </label>
        <div className="field"><span>Busca por número de peito</span>
          <label className="check"><input type="checkbox" checked={!!f.bib_search} onChange={(e) => setF({ ...f, bib_search: e.target.checked })} /><span><b>Ler os números de peito das fotos</b> <span className="muted">· para corridas, caminhadas e torneios: o atleta digita o número e acha as fotos dele</span></span></label>
          <small>O servidor lê os números depois do envio (leva alguns segundos por foto).</small>
        </div>
        <div className="field"><span>Parcerias</span>
          <label className="check"><input type="checkbox" checked={!!f.accepts_partners} onChange={(e) => setF({ ...f, accepts_partners: e.target.checked })} /><span><b>Aceita parcerias</b> <span className="muted">· outros fotógrafos do site cobrem o evento com você, cada um com a própria pasta do Drive</span></span></label>
          <small>Depois de salvar, aparece a equipe para você chamar os fotógrafos pelo nome. O cliente vê as fotos de todos juntas no evento.</small>
        </div>
      </div>
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
    let browserFaces = useFaces;
    if (useFaces) {
      try {
        await loadFaceApi((m) => push(() => ({ status: m })));
      } catch {
        browserFaces = false;
        push(() => ({ status: 'Reconhecimento facial indisponível neste navegador: o servidor vai procurar os rostos depois do envio.' }));
      }
    }
    const inflight = new Set();
    for (const file of files) {
      if (cancel.current) break;
      let faces = [];
      let facesDone = false;
      if (browserFaces) {
        push(() => ({ status: `Analisando rostos: ${file.name}` }));
        try {
          faces = await detectFaces(await fileToCanvas(file, 1400));
          facesDone = true;
        } catch { /* falhou neste arquivo: o servidor tenta depois */ }
      }
      while (inflight.size >= 3) await Promise.race(inflight);
      const form = new FormData();
      form.append('faces', JSON.stringify(faces.map(({ d, box }) => ({ d, box }))));
      if (facesDone) form.append('faces_done', '1');
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
        <label className="check" style={{ alignItems: 'center' }}><input type="checkbox" checked={useFaces} disabled={running} onChange={(e) => setUseFaces(e.target.checked)} /> <ScanFace size={16} /> Rostos no navegador (mais rápido)</label>
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

// Foto de destaque: a capa do card do evento na lista do site (e na pagina do evento).
function CoverPicker({ event, photos, onCover }) {
  const { toast } = useSite();
  const [open, setOpen] = useState(false);
  const choices = photos.filter((p) => !p.hidden && !p.pending);
  const pick = async (p) => {
    try {
      await api(`/studio/events/${event.id}/cover`, { method: 'PUT', body: { photoId: p.id } });
      toast('Foto de destaque definida');
      setOpen(false);
      onCover();
    } catch (err) {
      toast(err.message);
    }
  };
  return (
    <div className="card stack" style={{ gap: 14 }}>
      <div className="cover-picker">
        <div className="cover-preview"><EventCard event={event} to="#" /></div>
        <div className="stack" style={{ gap: 6 }}>
          <b>Foto de destaque</b>
          <span className="small muted">
            É a imagem do card do evento no site.{' '}
            {event.cover_photo_id ? 'Escolhida por você.'
              : event.hide_gallery || event.kind === 'pool' ? 'Nenhuma escolhida: como as fotos só aparecem pela selfie, o card fica sem imagem até você escolher.'
                : 'Nenhuma escolhida: o site usa a primeira foto.'}
          </span>
          <button className="btn btn-sm btn-accent" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>
            <Star size={14} /> {open ? 'Fechar' : 'Escolher foto de destaque'}
          </button>
        </div>
      </div>
      {open && (
        <div className="studio-photos cover-choices">
          {choices.map((p) => (
            <button key={p.id} className={`studio-photo${event.cover_photo_id === p.id ? ' is-cover' : ''}`} onClick={() => pick(p)} title="Usar como destaque">
              <img src={p.thumb} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PhotosManager({ event, photos: all, setPhotos, onCover, onQueued, team = false }) {
  const { toast } = useSite();
  const [by, setBy] = useState(null);
  const authors = [...new Map(all.filter((p) => p.photographer_id).map((p) => [p.photographer_id, p.photographer_name])).entries()];
  const photos = by ? all.filter((p) => p.photographer_id === by) : all;
  const del = async (p) => {
    if (!confirm('Excluir esta foto?')) return;
    try {
      await api(`/studio/photos/${p.id}`, { method: 'DELETE' });
      setPhotos((list) => list.filter((x) => x.id !== p.id));
    } catch (err) {
      toast(err.message);
    }
  };
  const toggleHidden = async (p) => {
    try {
      await api('/studio/photos/hidden', { method: 'PUT', body: { ids: [p.id], hidden: !p.hidden } });
      setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, hidden: !p.hidden } : x)));
      toast(p.hidden ? 'Foto visível de novo' : 'Foto oculta: não aparece mais no site');
    } catch (err) {
      toast(err.message);
    }
  };
  const cover = async (p) => {
    await api(`/studio/events/${event.id}/cover`, { method: 'PUT', body: { photoId: p.id } });
    onCover(p.id);
    toast('Capa definida');
  };
  if (!all.length) return null;
  const noFaces = photos.filter((p) => !p.faces).length;
  const hiddenCount = photos.filter((p) => p.hidden).length;
  return (
    <div className="card stack">
      <div className="row between"><h3>Fotos ({photos.length}){hiddenCount > 0 && <span className="small muted" style={{ fontWeight: 500 }}> · {hiddenCount} oculta(s)</span>}</h3>
        <span className="row small muted">{noFaces} sem rosto detectado
          {noFaces > 0 && !team && <button className="btn btn-sm btn-soft" onClick={async () => { const d = await api(`/studio/events/${event.id}/reindex`, { method: 'POST' }); toast(`${d.queued} foto(s) na fila do servidor`); onQueued?.(d.queued); }}><RefreshCw size={13} /> Procurar de novo</button>}
        </span>
      </div>
      {!team && authors.length > 1 && (
        <div className="chips">
          <button className={`chip${by == null ? ' active' : ''}`} onClick={() => setBy(null)}>Todos os fotógrafos <em>{all.length}</em></button>
          {authors.map(([id, name]) => <button key={id} className={`chip${by === id ? ' active' : ''}`} onClick={() => setBy(id)}>{name} <em>{all.filter((p) => p.photographer_id === id).length}</em></button>)}
        </div>
      )}
      <div className="studio-photos">
        {photos.map((p) => (
          <div key={p.id} className={`studio-photo${p.hidden ? ' is-hidden' : ''}`}>
            <img src={p.thumb} alt="" loading="lazy" />
            <div className="acts">
              {!team && <button title={p.hidden ? 'Mostrar no site' : 'Ocultar do site'} onClick={() => toggleHidden(p)}>{p.hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button>}
              {!team && <button title="Usar como capa" onClick={() => cover(p)}><Star size={14} fill={event.cover_photo_id === p.id ? '#ffb21a' : 'none'} /></button>}
              {!p.sold && <button title="Excluir" onClick={() => del(p)}><Trash2 size={14} /></button>}
            </div>
            <div className="ov">
              <span className="badge" style={{ background: 'rgba(255,255,255,.9)' }}><ScanFace size={11} /> {p.pending ? '…' : p.faces || 0}</span>
              {p.sold > 0 && <span className="badge badge-ok">{p.sold} venda(s)</span>}
              {event.cover_photo_id === p.id && <span className="badge badge-accent">Capa</span>}
              {p.hidden && <span className="badge badge-bad">Oculta</span>}
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
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) { setEvent(blank); setPhotos([]); return; }
    api(`/studio/events/${id}`).then((d) => { setEvent(d.event); setQueue(d.queue); }).catch(setError);
    api(`/studio/events/${id}/photos`).then((d) => setPhotos(d.photos)).catch(() => {});
  }, [id]);

  // Enquanto o servidor refaz vitrines ou procura rostos, atualiza a cada 4 s.
  const busy = queue && (queue.render > 0 || queue.faces > 0);
  useEffect(() => {
    if (!busy || !id) return;
    const t = setInterval(async () => {
      const d = await api(`/studio/events/${id}`).catch(() => null);
      if (!d) return;
      setEvent(d.event);
      setQueue(d.queue);
      if (!(d.queue.render || d.queue.faces)) api(`/studio/events/${id}/photos`).then((x) => setPhotos(x.photos)).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [busy, id]);

  if (error) return <ErrorBox error={error} />;
  if (!event) return <Loading />;
  if (event.role === 'team') {
    const t = event.team || {};
    const closed = t.upload_until && new Date(t.upload_until) < new Date();
    const full = t.max_photos && t.photos >= t.max_photos;
    return (
      <div className="stack" style={{ gap: 20, maxWidth: 1000 }}>
        <div className="row">
          <Link to="/painel/eventos" className="icon-btn" aria-label="Voltar"><ArrowLeft size={18} /></Link>
          <h2>{event.title}</h2>
          <span className="badge badge-accent">Colaboração</span>
        </div>
        <div className="kpis">
          <div className="kpi"><span>Suas fotos no evento</span><b>{t.photos}{t.max_photos ? ` de ${t.max_photos}` : ''}</b><small>{t.max_photos ? 'limite combinado com o organizador' : 'sem limite de fotos'}</small></div>
          <div className="kpi"><span>Suas vendas aqui</span><b>{money(t.cents)}</b><small>já descontadas a comissão do site{t.organizer_pct ? ` e a parte do organizador (${t.organizer_pct}%)` : ''}</small></div>
          <div className="kpi"><span>Envio de fotos</span><b>{closed ? 'Encerrado' : 'Aberto'}</b><small>{t.upload_until ? `até ${dateTimeBR(t.upload_until)}` : 'sem prazo'}</small></div>
        </div>
        {closed || full
          ? <div className="alert alert-warn">{closed ? 'O prazo de envio deste evento terminou.' : 'Você chegou ao limite de fotos deste evento.'} Fale com o organizador se precisar enviar mais.</div>
          : (
            <>
              <EventDrive eventId={event.id} onChange={() => api(`/studio/events/${event.id}/photos`).then((x) => setPhotos(x.photos)).catch(() => {})} />
              <Uploader eventId={event.id} onUploaded={(p) => { if (p) setPhotos((list) => [...list, { ...p, sold: 0 }]); }} />
            </>
          )}
        <PhotosManager event={event} photos={photos} setPhotos={setPhotos} onCover={() => {}} team />
      </div>
    );
  }

  const initial = event.id ? {
    id: event.id, title: event.title, event_date: event.event_date, category_id: event.category_id || '', city: event.city, venue: event.venue,
    description: event.description, price: centsToInput(event.price_cents), pack_price: centsToInput(event.pack_price_cents),
    discount_tiers: event.discount_tiers || [], status: event.status, hide_gallery: event.hide_gallery, watermark_mode: event.watermark_mode || 'site',
    visibility: event.visibility || 'public', password: '', has_password: event.visibility === 'password', publish_at: toLocalInput(event.publish_at),
    protect_mode: event.protect_mode || 'none', bib_search: !!event.bib_search, accepts_partners: !!event.accepts_partners,
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
      {event.id && event.pricing && (
        <div className="alert small">
          {event.pricing.archived
            ? <>Hoje as fotos deste {event.kind === 'pool' ? 'grupo do acervo' : 'evento'} são vendidas pelo <b>preço do acervo: {money(event.pricing.price_cents)}</b> por foto{event.kind === 'pool' ? '' : ' (o evento já passou do prazo de evento recente)'}. A tabela fica em Admin → Configurações.</>
            : event.pricing.archive_from
              ? <>Preço de evento recente: <b>{money(event.price_cents)}</b> por foto, com seus descontos e pacote. Em <b>{dateBR(event.pricing.archive_from)}</b> passa para o preço do acervo: <b>{money(event.pricing.archive_price_cents)}</b> por foto.</>
              : <>Este evento usa sempre o próprio preço (a passagem para o acervo está desligada).</>}
      </div>
      )}

      {event.id && event.bib && (
        <div className="alert small">Números de peito: <b>{event.bib.done}</b> de {event.bib.total} fotos lidas · <b>{event.bib.with_number}</b> com número encontrado.{event.bib.done < event.bib.total ? ' A leitura continua em segundo plano.' : ''}</div>
      )}
      {event.id && event.status !== 'published' && photos.length > 0 && (
        <div className="alert alert-warn">Este evento ainda não aparece no site. Mude o status para <b>Publicado</b> quando terminar de enviar.</div>
      )}

      {event.drive_folder_id && (
        <div className="alert row" style={{ gap: 8 }}><HardDrive size={16} /> Evento importado do Google Drive: fotos novas na pasta entram sozinhas.{event.auto_publish && event.status === 'draft' && ' Será publicado automaticamente quando o processamento terminar.'}</div>
      )}
      {busy && (
        <div className="alert alert-warn row" style={{ gap: 8 }}>
          <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          Processando no servidor: {queue.render > 0 && `${queue.render} vitrine(s) para refazer`}{queue.render > 0 && queue.faces > 0 && ' · '}{queue.faces > 0 && `${queue.faces} foto(s) procurando rostos`}
        </div>
      )}
      {event.id && (
        <div className="card row between" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 2 }}>
            <b>Exibição no site</b>
            <span className="tiny muted">{event.kind === 'pool' ? 'Hoje só aparece pela busca por selfie (acervo do ano), sem página de evento.' : event.hide_gallery ? 'Tem página de evento; as fotos só aparecem pela selfie.' : 'Tem página de evento com todas as fotos à mostra.'}</span>
          </div>
          <DisplaySelect event={event} onChanged={() => api(`/studio/events/${event.id}`).then((x) => { setEvent(x.event); setQueue(x.queue); })} />
        </div>
      )}
      {event.id && photos.length > 0 && <EventInsights eventId={event.id} />}
      {event.id && photos.length > 0 && (
        <CoverPicker event={event} photos={photos} onCover={() => api(`/studio/events/${event.id}`).then((x) => setEvent(x.event))} />
      )}
      {event.id && <EventDrive eventId={event.id} onChange={() => {
        api(`/studio/events/${event.id}`).then((x) => { setEvent(x.event); setQueue(x.queue); }).catch(() => {});
        api(`/studio/events/${event.id}/photos`).then((x) => setPhotos(x.photos)).catch(() => {});
      }} />}
      {event.id && <Uploader eventId={event.id} onUploaded={(p) => {
        if (!p) return;
        setPhotos((list) => [...list, { ...p, sold: 0 }]);
        if (p.pending) setQueue((q) => ({ render: q?.render || 0, faces: (q?.faces || 0) + 1 }));
      }} />}

      <EventForm
        key={event.id ? `${event.id}-${event.kind}-${event.hide_gallery}-${event.category_id}` : 'novo'}
        initial={initial}
        onSaved={async (d) => {
          await refresh();
          if (!event.id && d.event) nav(`/painel/eventos/${d.event.id}`, { replace: true });
          else api(`/studio/events/${event.id}`).then((x) => { setEvent(x.event); setQueue(x.queue); });
        }}
      />

      {event.id && <PhotosManager event={event} photos={photos} setPhotos={setPhotos} onCover={(pid) => setEvent({ ...event, cover_photo_id: pid })} onQueued={(n) => n && setQueue((q) => ({ render: q?.render || 0, faces: (q?.faces || 0) + n }))} />}
      {event.id && event.kind !== 'pool' && event.accepts_partners && <EventTeam eventId={event.id} />}
      {event.id && event.status === 'published' && <ShareKit event={event} />}
      {event.id && photos.length > 0 && <ArtEditor event={event} photos={photos} />}
      {event.id && <button className="btn btn-danger btn-sm" style={{ alignSelf: 'flex-start' }} onClick={remove}><Trash2 size={14} /> Excluir evento</button>}
    </div>
  );
}
