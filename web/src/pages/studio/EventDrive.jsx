import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HardDrive, RefreshCw, Unlink, Search, FolderOpen, Camera, Tag } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useSite } from '../../lib/site.jsx';
import { dateBR, dateTimeBR, plural } from '../../lib/format.js';

// Fotos do evento: puxadas do acervo do ano (pela tag = nome da pasta) ou de uma pasta do Drive colada aqui.
export default function EventDrive({ eventId, onChange }) {
  const { toast } = useSite();
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('acervo');
  const [q, setQ] = useState('');
  const [pool, setPool] = useState(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api(`/studio/events/${eventId}/drive`).then(setData).catch(() => {});
  const searchPool = (text = q) => api(`/studio/pool${text ? `?q=${encodeURIComponent(text)}` : ''}`).then((d) => setPool(d.pool)).catch(() => setPool([]));
  useEffect(() => { load(); searchPool(''); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = data?.source;
  const running = s && s.active && (['na fila', 'sincronizando'].includes(s.last_status) || s.last_status?.startsWith('continuando') || s.pending > 0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { load(); onChange?.(); }, 5000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;
  if (data.kind === 'pool') {
    return (
      <div className="alert">Este é um grupo do <b>acervo do ano</b> (pasta {data.folder_path}). Ele aparece na busca e na galeria do ano. Para virar um evento,
        crie um <Link to="/painel/eventos/novo" style={{ textDecoration: 'underline' }}>novo evento</Link> e puxe estas fotos pelo acervo.</div>
    );
  }

  const attach = async (g) => {
    if (!confirm(`Puxar as ${g.photo_count} fotos de "${g.drive_folder_path || g.title}" para este evento?`)) return;
    setBusy(true);
    try {
      const d = await api(`/studio/events/${eventId}/attach`, { method: 'POST', body: { pool_event_id: g.id } });
      toast(`${d.photos} fotos de ${d.from} agora estão neste evento.`);
      load();
      searchPool();
      onChange?.();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api(`/studio/events/${eventId}/drive`, { method: 'POST', body: { link } });
      toast(d.merged ? `Pasta ligada. As fotos que estavam no acervo vieram para este evento.` : `Pasta “${d.name}” ligada. Importação começando.`);
      setLink('');
      load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const release = async () => {
    if (!confirm('Desligar a pasta deste evento? As fotos já puxadas continuam aqui; fotos novas dessa pasta voltam a ir para o acervo do ano.')) return;
    await api(`/studio/events/${eventId}/drive?release=1`, { method: 'DELETE' });
    load();
  };

  const linked = !!data.folder_id;
  return (
    <div className="card stack">
      <div className="row between">
        <h3 className="row" style={{ gap: 8 }}><HardDrive size={18} /> Fotos do evento</h3>
        <span className="small muted">{plural(data.photos, 'foto', 'fotos')}{s?.pending ? ` · ${s.pending} processando` : ''}</span>
      </div>

      {linked ? (
        <>
          <p className="small">
            <Tag size={14} style={{ verticalAlign: -2 }} /> Fotos da pasta <b>{data.folder_path || 'do Drive'}</b>. Fotos novas que você colocar nessa pasta entram sozinhas neste evento
            (na próxima verificação da pasta geral{s ? ' ou desta pasta' : ''}).
          </p>
          {s && (
            <span className="tiny muted">
              {s.last_status === 'erro' ? <span style={{ color: 'var(--bad)' }}>Erro: {s.last_error}</span> : <>Última rodada: {s.last_status || '—'}</>}
              {s.last_sync_at && <> · verificada em {dateTimeBR(s.last_sync_at)}</>}
            </span>
          )}
          <div className="row">
            {s && <button className="btn btn-sm btn-soft" onClick={async () => { await api(`/studio/drive/${s.id}/sync`, { method: 'POST' }); toast('Sincronização na fila'); load(); }}><RefreshCw size={14} /> Sincronizar agora</button>}
            <button className="btn btn-sm btn-ghost" onClick={release}><Unlink size={14} /> Desligar pasta</button>
          </div>
        </>
      ) : (
        <>
          <div className="tabs">
            <button className={mode === 'acervo' ? 'active' : ''} onClick={() => setMode('acervo')}>Puxar do acervo</button>
            <button className={mode === 'link' ? 'active' : ''} onClick={() => setMode('link')}>Colar link de pasta</button>
          </div>
          {mode === 'acervo' ? (
            <div className="stack">
              <p className="small muted">Cada pasta da pasta geral (ex.: <code>2026 / 10 / renan_01_10_2026</code>) vira uma <b>tag</b> no acervo. Escolha a tag deste evento: só essas fotos aparecem aqui, sem duplicar nada.</p>
              <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); searchPool(); }}>
                <div className="grow" style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: 12, top: 15 }} color="#74706a" />
                  <input className="input" style={{ paddingLeft: 36 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por nome da pasta (ex.: renan, formatura, 10)" />
                </div>
                <button className="btn btn-soft">Filtrar</button>
              </form>
              {pool === null ? <span className="small muted">Carregando…</span> : pool.length ? (
                <div className="stack" style={{ gap: 8 }}>
                  {pool.map((g) => (
                    <div key={g.id} className="row" style={{ flexWrap: 'nowrap', gap: 12, padding: 8, border: '1px solid var(--line)', borderRadius: 10 }}>
                      {g.cover_thumb ? <img src={g.cover_thumb} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6 }} />
                        : <div style={{ width: 64, height: 48, borderRadius: 6, background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }}><Camera size={16} /></div>}
                      <div className="grow" style={{ minWidth: 0 }}>
                        <b className="small">{g.tag || g.title}</b>
                        <div className="tiny muted"><FolderOpen size={11} style={{ verticalAlign: -1 }} /> {g.drive_folder_path || g.title} · {dateBR(g.event_date)} · {plural(g.photo_count, 'foto', 'fotos')}</div>
                      </div>
                      <button className="btn btn-sm btn-accent" disabled={busy} onClick={() => attach(g)}>Puxar estas fotos</button>
                    </div>
                  ))}
                </div>
              ) : <div className="alert">Nenhuma pasta no acervo{q ? ' com esse filtro' : ''}. As pastas aparecem aqui depois que a pasta geral é sincronizada (Painel → Google Drive).</div>}
            </div>
          ) : !data.info.configured ? (
            <div className="alert alert-warn">A integração com o Google Drive ainda não foi ativada no servidor.</div>
          ) : (
            <form className="stack" onSubmit={connect}>
              <p className="small muted">Para uma pasta que <b>não</b> está dentro da pasta geral. {data.info.share_with && <>Compartilhe a pasta com <b style={{ userSelect: 'all' }}>{data.info.share_with}</b>.</>}</p>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input className="input grow" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" required />
                <button className="btn btn-accent" disabled={busy}>{busy ? 'Ligando…' : 'Ligar pasta'}</button>
              </div>
              {error && <div className="alert alert-bad">{error}</div>}
            </form>
          )}
        </>
      )}
    </div>
  );
}
