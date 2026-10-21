import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HardDrive, RefreshCw, Unlink } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useSite } from '../../lib/site.jsx';
import { dateTimeBR } from '../../lib/format.js';

// Pasta do Google Drive so deste evento (ex.: 2026/10/formatura_futurao_20_10_2026).
export default function EventDrive({ eventId, onChange }) {
  const { toast } = useSite();
  const [data, setData] = useState(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api(`/studio/events/${eventId}/drive`).then(setData).catch(() => {});
  useEffect(() => { load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Atualiza enquanto importa.
  const s = data?.source;
  const running = s && s.active && (['na fila', 'sincronizando'].includes(s.last_status) || s.last_status?.startsWith('continuando') || s.pending > 0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { load(); onChange?.(); }, 5000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;

  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api(`/studio/events/${eventId}/drive`, { method: 'POST', body: { link } });
      toast(d.merged ? `Pasta ligada. As fotos que estavam em “${d.merged}” vieram para este evento.` : `Pasta “${d.name}” ligada. Importação começando.`);
      setLink('');
      load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="row between">
        <h3 className="row" style={{ gap: 8 }}><HardDrive size={18} /> Pasta do Google Drive</h3>
        {s && <span className="small muted">{s.photos} fotos{s.pending ? ` · ${s.pending} processando` : ''}{s.skipped ? ` · ${s.skipped} recusadas` : ''}</span>}
      </div>
      {!data.info.configured ? (
        <div className="alert alert-warn">A integração com o Google Drive ainda não foi ativada no servidor (Admin → Configurações).</div>
      ) : s ? (
        <>
          <p className="small">Ligado à pasta <b>{s.name}</b>. Fotos novas que você colocar nela entram sozinhas neste evento.</p>
          <span className="tiny muted">
            {s.last_status === 'erro' ? <span style={{ color: 'var(--bad)' }}>Erro: {s.last_error}</span> : <>Última rodada: {s.last_status || '—'}</>}
            {s.last_sync_at && <> · verificada em {dateTimeBR(s.last_sync_at)}</>}
          </span>
          <div className="row">
            <button className="btn btn-sm btn-soft" onClick={async () => { await api(`/studio/drive/${s.id}/sync`, { method: 'POST' }); toast('Sincronização na fila'); load(); }}><RefreshCw size={14} /> Sincronizar agora</button>
            <button className="btn btn-sm btn-ghost" onClick={async () => { if (!confirm('Desligar a pasta? As fotos já importadas continuam no evento.')) return; await api(`/studio/events/${eventId}/drive`, { method: 'DELETE' }); load(); }}><Unlink size={14} /> Desligar</button>
          </div>
        </>
      ) : (
        <form className="stack" onSubmit={connect}>
          <p className="small muted">
            Cole o link da pasta deste evento (ex.: <code>2026 / 10 / formatura_futurao_20_10_2026</code>). Só as fotos dela entram aqui,
            mesmo que a pasta também esteja dentro da pasta do ano. {data.info.share_with && <>Compartilhe a pasta com <b style={{ userSelect: 'all' }}>{data.info.share_with}</b>.</>}
          </p>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input grow" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" required />
            <button className="btn btn-accent" disabled={busy}>{busy ? 'Ligando…' : 'Ligar pasta'}</button>
          </div>
          {error && <div className="alert alert-bad">{error}</div>}
          <span className="tiny muted">A pasta geral do ano fica em <Link to="/painel/drive" style={{ textDecoration: 'underline' }}>Google Drive</Link>.</span>
        </form>
      )}
    </div>
  );
}
