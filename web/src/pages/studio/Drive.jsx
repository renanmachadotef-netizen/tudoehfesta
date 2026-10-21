import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderOpen, RefreshCw, Pause, Play, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi, useSite } from '../../lib/site.jsx';
import { dateTimeBR, money, centsToInput } from '../../lib/format.js';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import { PageHead } from './Studio.jsx';

const WM = { site: 'Padrão do site', photographer: 'Minha marca', none: 'Sem marca d’água' };
const blank = () => ({ link: '', year: new Date().getFullYear(), category_id: '', price: '15,00', pack_price: '', auto_publish: true, hide_gallery: false, watermark_mode: 'site' });

function SourceForm({ initial, onSubmit, submitLabel, withLink }) {
  const { categories = [] } = useSite();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(f);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      {withLink && <label className="field"><span>Link da pasta do ano no Google Drive</span><input className="input" required value={f.link} onChange={set('link')} placeholder="https://drive.google.com/drive/folders/…" /></label>}
      <div className="grid-3">
        <label className="field"><span>Ano</span><input className="input" type="number" value={f.year} onChange={set('year')} /></label>
        <label className="field"><span>Categoria dos eventos</span>
          <select className="select" value={f.category_id || ''} onChange={set('category_id')}>
            <option value="">Sem categoria</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Marca d’água</span>
          <select className="select" value={f.watermark_mode} onChange={set('watermark_mode')}>
            {Object.entries(WM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field"><span>Preço por foto (R$)</span><input className="input" value={f.price} onChange={set('price')} inputMode="decimal" /></label>
        <label className="field"><span>Pacote: teto por cliente (R$)</span><input className="input" value={f.pack_price || ''} onChange={set('pack_price')} inputMode="decimal" placeholder="opcional" /></label>
      </div>
      <label className="check"><input type="checkbox" checked={f.auto_publish} onChange={set('auto_publish')} /><span><b>Publicar automaticamente</b> quando as fotos de um evento terminarem de ser processadas. Desmarcado, o evento fica em rascunho para você revisar.</span></label>
      <label className="check"><input type="checkbox" checked={f.hide_gallery} onChange={set('hide_gallery')} /><span><b>Não exibir as fotos dos eventos</b>: as fotos só aparecem para quem se encontrar pela selfie.</span></label>
      <span className="tiny muted">Esses padrões valem para os eventos novos criados a partir da pasta. Depois dá para mudar cada evento individualmente.</span>
      {error && <div className="alert alert-bad">{error}</div>}
      <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? 'Aguarde…' : submitLabel}</button>
    </form>
  );
}

function statusOf(s) {
  if (!s.active) return ['', 'Pausada'];
  if (s.last_status === 'erro') return ['bad', 'Erro'];
  if (s.last_status === 'sincronizando' || s.last_status?.startsWith('continuando') || s.last_status === 'na fila') return ['run', s.last_status === 'na fila' ? 'Na fila' : 'Importando'];
  return ['ok', 'Em dia'];
}

function SourceCard({ s, reload }) {
  const { toast } = useSite();
  const [edit, setEdit] = useState(false);
  const [skips, setSkips] = useState(null);
  const [dot, label] = statusOf(s);
  const act = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg);
      reload();
    } catch (err) {
      toast(err.message);
    }
  };
  return (
    <div className="card stack">
      <div className="row between">
        <div className="row" style={{ gap: 10 }}>
          <FolderOpen size={22} color="var(--accent)" />
          <div><b>{s.name || 'Pasta do Drive'}</b><div className="tiny muted">{s.year} · {money(s.price_cents)}/foto · {WM[s.watermark_mode]}{s.hide_gallery ? ' · só selfie' : ''}{s.auto_publish ? ' · publica sozinho' : ' · revisão manual'}</div></div>
        </div>
        <span className="row small" style={{ gap: 6 }}><span className={`status-dot ${dot}`} /> {label}</span>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
        <div className="kpi"><span>Eventos</span><b>{s.events}</b></div>
        <div className="kpi"><span>Fotos</span><b>{s.photos}</b></div>
        <div className="kpi"><span>Processando</span><b>{s.pending}</b></div>
        <div className="kpi"><span>Recusadas</span><b>{s.skipped}</b></div>
      </div>
      <div className="small muted">
        {s.last_status && s.last_status !== 'erro' && <>Última rodada: {s.last_status}. </>}
        {s.last_sync_at && <>Verificada em {dateTimeBR(s.last_sync_at)}.</>}
      </div>
      {s.last_status === 'erro' && <div className="alert alert-bad row" style={{ gap: 8 }}><AlertTriangle size={16} /> {s.last_error}</div>}
      <div className="row">
        <button className="btn btn-sm btn-accent" onClick={() => act(() => api(`/studio/drive/${s.id}/sync`, { method: 'POST' }), 'Sincronização na fila')}><RefreshCw size={14} /> Sincronizar agora</button>
        <button className="btn btn-sm btn-soft" onClick={() => setEdit((v) => !v)}>Padrões</button>
        {s.skipped > 0 && <button className="btn btn-sm btn-soft" onClick={async () => setSkips(skips ? null : (await api(`/studio/drive/${s.id}/skips`)).skips)}>Ver recusadas</button>}
        <button className="btn btn-sm btn-ghost" onClick={() => act(() => api(`/studio/drive/${s.id}`, { method: 'PUT', body: { active: !s.active } }))}>{s.active ? <><Pause size={14} /> Pausar</> : <><Play size={14} /> Retomar</>}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => confirm('Desligar esta pasta? Os eventos e fotos já importados continuam no site.') && act(() => api(`/studio/drive/${s.id}`, { method: 'DELETE' }), 'Pasta desligada')}><Trash2 size={14} /> Desligar</button>
      </div>
      {skips && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="table-wrap"><table className="table"><tbody>
            {skips.map((k) => <tr key={k.name + k.created_at}><td className="small">{k.name}</td><td className="small muted">{k.reason}</td></tr>)}
          </tbody></table></div>
          <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => act(() => api(`/studio/drive/${s.id}/skips`, { method: 'DELETE' }), 'Recusadas serão revisadas de novo').then(() => setSkips(null))}>Revisar de novo na próxima rodada</button>
        </div>
      )}
      {edit && (
        <SourceForm
          initial={{ year: s.year, category_id: s.category_id || '', price: centsToInput(s.price_cents), pack_price: centsToInput(s.pack_price_cents), auto_publish: s.auto_publish, hide_gallery: s.hide_gallery, watermark_mode: s.watermark_mode }}
          submitLabel="Salvar padrões"
          onSubmit={async (f) => { await api(`/studio/drive/${s.id}`, { method: 'PUT', body: f }); setEdit(false); toast('Padrões salvos'); reload(); }}
        />
      )}
    </div>
  );
}

export default function Drive() {
  const { toast } = useSite();
  const { data, loading, error, reload } = useApi('/studio/drive');
  const [adding, setAdding] = useState(false);

  // Atualiza o status enquanto alguma pasta estiver importando.
  const running = data?.sources?.some((s) => s.pending > 0 || ['sincronizando', 'na fila'].includes(s.last_status) || s.last_status?.startsWith('continuando'));
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [running, reload]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { info, sources } = data;

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 1000 }}>
      <PageHead title="Google Drive">
        {info.configured && !adding && <button className="btn btn-accent btn-sm" onClick={() => setAdding(true)}>Ligar pasta</button>}
      </PageHead>

      <div className="card-flat stack small">
        <b>Como funciona</b>
        <p className="muted">Crie no Drive uma pasta para o ano (ex.: <b>2026</b>) e, dentro dela, uma subpasta para cada evento com a data no começo do nome:</p>
        <pre style={{ margin: 0, padding: 12, background: '#fff', borderRadius: 8, fontSize: 13, overflowX: 'auto' }}>{`2026/
  2026-09-12 Formatura CEJA - Criciúma/   → evento "Formatura CEJA", 12/09/2026, Criciúma
  2026-10-04 AgroTexas/                   → evento "AgroTexas", 04/10/2026
  foto-solta.jpg                          → evento "Fotos de 2026"`}</pre>
        <p className="muted">A cada {info.sync_minutes} minutos o sistema confere a pasta, cria os eventos, importa as fotos novas, recusa repetidas, corrompidas e de resolução baixa, reconhece os rostos e publica. Pode ir colocando fotos durante o evento.</p>
        {info.mode === 'service_account' && <p>Compartilhe a pasta (como <b>Leitor</b>) com: <code style={{ userSelect: 'all' }}>{info.share_with}</code></p>}
        {info.mode === 'api_key' && <p>Deixe a pasta como <b>“Qualquer pessoa com o link”</b> (Leitor).</p>}
      </div>

      {!info.configured && (
        <div className="alert alert-warn">A integração com o Google Drive ainda não foi ativada no servidor. O administrador precisa configurar a credencial do Google no Easypanel (veja o README do projeto).</div>
      )}

      {adding && (
        <div className="card stack">
          <h3>Ligar pasta do ano</h3>
          <SourceForm
            initial={blank()}
            withLink
            submitLabel="Ligar e importar"
            onSubmit={async (f) => { const d = await api('/studio/drive', { method: 'POST', body: f }); toast(`Pasta “${d.name}” ligada. A importação começa em instantes.`); setAdding(false); reload(); }}
          />
        </div>
      )}

      {sources.map((s) => <SourceCard key={s.id} s={s} reload={reload} />)}
      {!sources.length && info.configured && !adding && <p className="muted">Nenhuma pasta ligada ainda.</p>}
      <p className="tiny muted">Os eventos criados pela pasta aparecem em <Link to="/painel/eventos" style={{ textDecoration: 'underline' }}>Eventos</Link>, onde dá para ajustar nome, data, preço e capa.</p>
    </div>
  );
}
