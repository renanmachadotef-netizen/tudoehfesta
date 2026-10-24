import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play, HardDrive, CheckCircle2, AlertTriangle, Images, ScanFace, ShoppingBag, Users, Server, FolderX, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, compact } from '../../lib/format.js';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import { PageHead } from '../studio/Studio.jsx';

const KINDS = {
  drive: ['Drive', 'drive'], import: ['Importação', 'drive'], pasta: ['Pasta nova', 'drive'], publicacao: ['Publicado', 'drive'],
  match: ['Encontradas', 'cliente'], rosto: ['Rosto', 'cliente'], blur: ['Borrar', 'cliente'], cliente: ['Cadastro', 'cliente'],
  pedido: ['Pedido', 'venda'], venda: ['Venda', 'venda'], copia: ['Original', 'venda'],
  exclusao: ['Exclusão', 'erro'], erro: ['Erro', 'erro'], faxina: ['Faxina', 'drive'],
};
const FILTERS = [['all', 'Tudo'], ['drive', 'Drive'], ['cliente', 'Clientes'], ['venda', 'Vendas'], ['erro', 'Erros']];

const ago = (iso, now) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
};
const hms = (t) => new Date(t).toLocaleTimeString('pt-BR');
const gb = (b) => `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
const uptime = (s) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} dias`);

// O que o servidor esta fazendo agora, numa frase.
function NowCard({ d, now }) {
  const run = d.drive.running;
  const q = d.queue;
  const busy = [
    q.render > 0 && `${q.render} prévias para gerar`,
    q.faces > 0 && `${q.faces} fotos para analisar rostos`,
    q.copy > 0 && `${q.copy} originais vendidos para copiar`,
    q.face_scans > 0 && `${q.face_scans} cliente(s) com rosto novo para varrer`,
    q.match_backlog > 0 && `${compact(q.match_backlog)} rostos para comparar com os clientes`,
  ].filter(Boolean);
  if (run) {
    const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
    return (
      <div className="card stack live-now">
        <div className="row" style={{ gap: 10 }}><span className="live-dot" /><b>Importando do Google Drive: “{run.source}”</b></div>
        <span className="small">{run.phase === 'importando' ? <>Pasta: <b>{run.folder || '…'}</b></> : 'Lendo as pastas do Drive…'}</span>
        {run.total > 0 && (
          <>
            <div className="live-bar"><i style={{ width: `${pct}%` }} /></div>
            <span className="tiny muted">
              Rodada atual: {run.done} de {run.total} ({run.imported} importadas{run.skipped ? `, ${run.skipped} recusadas` : ''}) · {compact(run.pending_all)} fotos novas no total; importa em rodadas de {run.total}, uma emendada na outra
            </span>
          </>
        )}
        {busy.length > 0 && <span className="tiny muted">Também na fila: {busy.join(' · ')}</span>}
      </div>
    );
  }
  if (busy.length) {
    return (
      <div className="card stack live-now">
        <div className="row" style={{ gap: 10 }}><span className="live-dot" /><b>Processando</b></div>
        <span className="small">{busy.join(' · ')}</span>
      </div>
    );
  }
  const last = d.drive.sources.map((s) => s.last_sync_at).filter(Boolean).sort().pop();
  const nextMin = last ? Math.max(0, Math.round(d.drive.sync_minutes - (now - new Date(last).getTime()) / 60000)) : null;
  return (
    <div className="card row live-now" style={{ gap: 10 }}>
      <CheckCircle2 size={20} color="var(--ok)" />
      <div className="stack" style={{ gap: 2 }}>
        <b>Tudo em dia</b>
        <span className="small muted">
          Nenhuma foto esperando. {d.drive.configured ? (nextMin != null ? `Próxima olhada no Drive em ~${nextMin} min (a cada ${d.drive.sync_minutes} min).` : 'O Drive é verificado periodicamente.') : 'Google Drive não configurado.'}
        </span>
      </div>
    </div>
  );
}

// Retrato da pasta raiz (ultima leitura do Drive): pastas e fotos por ano, quantas ja estao no site e quantas faltam.
function DriveScan({ d, now }) {
  const [showIgnored, setShowIgnored] = useState(false);
  const src = d.drive.sources.find((s) => s.scan && s.kind !== 'event');
  if (!src) return null;
  const sc = src.scan;
  const run = d.drive.running?.source_id === src.id ? d.drive.running : null;
  const doneNow = run ? run.imported + run.skipped : 0;
  const pending = Math.max(0, sc.pending - doneNow);
  const total = sc.files;
  const done = total - pending;
  const perMin = d.rates.import.m10 / 10 || d.rates.import.m60 / 60;
  const eta = pending && perMin > 0 ? pending / perMin : null;
  const etaTxt = eta == null ? null : eta < 60 ? `~${Math.ceil(eta)} min` : `~${Math.floor(eta / 60)} h ${Math.round(eta % 60)} min`;
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="row between">
        <h3 className="row" style={{ gap: 8 }}><HardDrive size={17} /> Pasta “{src.name}” no Drive</h3>
        <span className="tiny muted">lida {ago(sc.at, now)}</span>
      </div>
      <div className="kpis">
        <button type="button" className="kpi kpi-btn" onClick={() => setShowIgnored((v) => !v)} aria-expanded={showIgnored}>
          <span className="row between" style={{ width: '100%' }}>Pastas de evento {showIgnored ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
          <b>{sc.folders.toLocaleString('pt-BR')}</b>
          <small>em {sc.years.length} ano(s) · {sc.ignored ? `${sc.ignored} ignorada(s) pelo nome: toque para ver` : 'nenhuma ignorada'}</small>
        </button>
        <div className="kpi"><span>Fotos no Drive</span><b>{total.toLocaleString('pt-BR')}</b></div>
        <div className="kpi"><span>Já tratadas</span><b>{done.toLocaleString('pt-BR')}</b><small>{total ? Math.round((done / total) * 100) : 100}% (no site ou recusadas)</small></div>
        <div className="kpi accent"><span>Faltam</span><b>{pending.toLocaleString('pt-BR')}</b><small>{pending ? (etaTxt ? `previsão ${etaTxt} no ritmo atual` : 'aguardando a próxima rodada') : 'tudo em dia'}</small></div>
      </div>
      {showIgnored && <IgnoredFolders sc={sc} />}
      <div className="live-bar"><i style={{ width: `${total ? Math.round((done / total) * 100) : 100}%` }} /></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Ano</th><th className="num">Pastas</th><th className="num">Fotos no Drive</th><th className="num">Tratadas</th><th className="num">Faltam</th><th style={{ width: '30%' }}></th></tr></thead>
        <tbody>{sc.years.map((y) => {
          const left = y.files - y.done;
          return (
            <tr key={y.year}>
              <td><b>{y.year}</b></td><td className="num">{y.folders}</td><td className="num">{y.files.toLocaleString('pt-BR')}</td>
              <td className="num">{y.done.toLocaleString('pt-BR')}</td><td className="num">{left ? left.toLocaleString('pt-BR') : '—'}</td>
              <td><div className="live-bar"><i style={{ width: `${y.files ? Math.round((y.done / y.files) * 100) : 100}%` }} /></div></td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <span className="tiny muted">Os números por ano são da leitura “{ago(sc.at, now)}” (o Drive é relido a cada rodada de importação); o total “Faltam” já desconta a rodada em andamento.</span>
    </div>
  );
}

// Pastas puladas pelo nome (ex.: "descartadas", "dsc", "site"): onde estao e qual palavra fez pular.
function IgnoredFolders({ sc }) {
  const list = sc.ignored_list;
  return (
    <div className="ignored-box stack" style={{ gap: 10 }}>
      <div className="row between">
        <b className="row" style={{ gap: 6 }}><FolderX size={16} /> Pastas ignoradas pelo nome</b>
        <Link to="/painel/drive" className="small" style={{ textDecoration: 'underline' }}>Mudar as palavras ignoradas</Link>
      </div>
      {!sc.ignored ? (
        <span className="small muted">Nenhuma pasta foi ignorada na última leitura.</span>
      ) : !list ? (
        <span className="small muted">{sc.ignored} pasta(s) ignorada(s). A lista com os nomes aparece depois da próxima leitura do Drive.</span>
      ) : (
        <>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Pasta</th><th>Onde está</th><th>Palavra</th></tr></thead>
            <tbody>{list.map((f, i) => (
              <tr key={i}><td><b>{f.name}</b></td><td className="small muted">{f.path || '—'}</td><td>{f.word ? <span className="badge">{f.word}</span> : '—'}</td></tr>
            ))}</tbody>
          </table></div>
          <span className="tiny muted">As fotos dessas pastas (e das subpastas delas) não entram no site.{sc.ignored > list.length ? ` Mostrando ${list.length} de ${sc.ignored}.` : ''}</span>
        </>
      )}
    </div>
  );
}

export default function Live() {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('all');
  const [now, setNow] = useState(Date.now());
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api('/admin/live');
        if (!alive) return;
        setD(data);
        setNow(Date.now());
        setError(null);
      } catch (err) {
        if (alive) setError(err);
      }
    };
    load();
    if (!paused) timer.current = setInterval(load, 4000);
    return () => { alive = false; clearInterval(timer.current); };
  }, [paused]);

  if (!d && error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const t = d.totals;
  const r = d.rates;
  const feed = d.activity.filter((a) => filter === 'all' || (KINDS[a.kind]?.[1] || 'drive') === filter);
  const disk = d.server.disk;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead title="Ao vivo">
        <span className="small muted row" style={{ gap: 6 }}>{!paused && <span className="live-dot" />}{paused ? 'Pausado' : 'Atualiza a cada 4 s'}</span>
        <button className="btn btn-sm btn-soft" onClick={() => setPaused(!paused)}>{paused ? <><Play size={14} /> Retomar</> : <><Pause size={14} /> Pausar</>}</button>
      </PageHead>
      {error && <div className="alert alert-warn">Sem resposta do servidor agora ({error.message}). Tentando de novo…</div>}

      <NowCard d={d} now={now} />

      <div className="kpis">
        <div className="kpi"><span>Importadas do Drive</span><b>{r.import.m10}</b><small>últimos 10 min · {r.import.m60} na última hora{r.skip.m60 ? ` · ${r.skip.m60} recusadas` : ''}</small></div>
        <div className="kpi"><span>Fotos analisadas (rostos)</span><b>{r.scan.m10}</b><small>últimos 10 min · {r.scan.m60.toLocaleString("pt-BR")} na última hora · {compact(r.faces.m60)} rostos achados</small></div>
        <div className="kpi"><span>Prévias refeitas</span><b>{r.render.m10}</b><small>últimos 10 min · {r.render.m60} em 1 h</small></div>
        <div className="kpi"><span>Encontradas p/ clientes</span><b>{r.match.m60}</b><small>na última hora · {t.matches_24h} em 24 h</small></div>
      </div>

      <div className="kpis">
        <div className="kpi"><span><Images size={14} style={{ verticalAlign: -2 }} /> Fotos no site</span><b>{t.photos.toLocaleString('pt-BR')}</b><small>+{t.photos_24h.toLocaleString('pt-BR')} em 24 h · {t.pool_groups} pastas no acervo · {t.events} eventos</small></div>
        <div className="kpi"><span><ScanFace size={14} style={{ verticalAlign: -2 }} /> Rostos indexados</span><b>{t.faces.toLocaleString('pt-BR')}</b><small>{t.old_faces ? `no reconhecimento atual · ${t.old_faces.toLocaleString('pt-BR')} do modelo antigo ainda serão refeitos` : 'no reconhecimento atual'}</small></div>
        <div className="kpi"><span><Users size={14} style={{ verticalAlign: -2 }} /> Clientes</span><b>{t.customers}</b><small>{t.face_users} com rosto cadastrado · {t.blur_users} pediram para borrar</small></div>
        <div className="kpi accent"><span><ShoppingBag size={14} style={{ verticalAlign: -2 }} /> Vendido hoje</span><b>{money(d.orders.paid_today_cents)}</b><small>{d.orders.paid_today} pagos · {d.orders.today} pedidos hoje · {d.orders.pending} aguardando</small></div>
      </div>

      <DriveScan d={d} now={now} />

      <div className="live-grid">
        <div className="card stack" style={{ gap: 10 }}>
          <div className="row between">
            <h3>Atividade</h3>
            <div className="chips">
              {FILTERS.map(([k, label]) => <button key={k} className={`chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{label}</button>)}
            </div>
          </div>
          {feed.length ? (
            <ul className="live-feed">
              {feed.map((a, i) => {
                const [label, group] = KINDS[a.kind] || [a.kind, 'drive'];
                return (
                  <li key={a.t + '-' + i} className={`lf-${group}`}>
                    <time>{hms(a.t)}</time><span className="lf-tag">{label}</span><span className="lf-text">{a.text}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="small muted">Nada registrado {filter === 'all' ? `desde que o servidor ligou (${uptime(d.server.uptime_s)} atrás)` : 'neste filtro'}. A atividade fica só na memória e recomeça a cada deploy.</p>}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <div className="card stack" style={{ gap: 10 }}>
            <div className="row between"><h3>Chegando agora</h3><Link to="/painel/acervo" className="small" style={{ textDecoration: 'underline' }}>Acervo por ano</Link></div>
            <div className="live-thumbs">
              {d.recentPhotos.map((p) => (
                <div key={p.id} title={`${p.event_title} · ${p.faces} rosto(s) · ${ago(p.created_at, now)}`}><img src={p.thumb} alt="" loading="lazy" /></div>
              ))}
            </div>
            {d.recentPhotos[0] && <span className="tiny muted">Última: {d.recentPhotos[0].event_title}, {ago(d.recentPhotos[0].created_at, now)}</span>}
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <h3 className="row" style={{ gap: 8 }}><HardDrive size={17} /> Pastas monitoradas</h3>
            {d.drive.sources.length ? d.drive.sources.map((s) => (
              <div key={s.id} className="stack" style={{ gap: 2, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
                <div className="row between">
                  <b className="small">{s.kind === 'event' ? `${s.event_title} (pasta do evento)` : s.name}</b>
                  <span className={`badge ${s.last_status === 'erro' ? 'badge-bad' : s.last_status?.startsWith('ok') ? 'badge-ok' : 'badge-warn'}`}>
                    {s.last_status === 'erro' ? 'erro' : s.last_status?.startsWith('ok') ? 'em dia' : s.last_status || 'aguardando'}
                  </span>
                </div>
                <span className="tiny muted">
                  {s.photos.toLocaleString('pt-BR')} fotos{s.skipped ? ` · ${s.skipped} recusadas` : ''} · {s.last_sync_at ? `verificada ${ago(s.last_sync_at, now)}` : 'nunca verificada'}
                  {!s.active && ' · pausada'}
                </span>
                {s.last_status && !s.last_status.startsWith('ok') && s.last_status !== 'erro' && <span className="tiny">{s.last_status}</span>}
                {s.last_error && <span className="tiny" style={{ color: 'var(--bad)' }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {s.last_error}</span>}
              </div>
            )) : <span className="small muted">Nenhuma pasta ligada. <Link to="/painel/drive" style={{ textDecoration: 'underline' }}>Ligar pasta</Link></span>}
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <div className="row between"><h3>Pedidos recentes</h3><Link to="/admin/pedidos" className="small" style={{ textDecoration: 'underline' }}>Todos</Link></div>
            {d.orders.last.length ? d.orders.last.map((o) => (
              <div key={o.code} className="row between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                <span><b>{o.code}</b> · {o.buyer} · {o.items} foto(s)<br /><span className="tiny muted">{ago(o.created_at, now)}</span></span>
                <span style={{ textAlign: 'right' }}>{money(o.total_cents)}<br /><span className={`badge ${o.status === 'paid' ? 'badge-ok' : o.status === 'pending' ? 'badge-warn' : 'badge-bad'}`}>{{ paid: 'pago', pending: 'aguardando', cancelled: 'cancelado', refunded: 'estornado' }[o.status] || o.status}</span></span>
              </div>
            )) : <span className="small muted">Nenhum pedido ainda.</span>}
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <h3 className="row" style={{ gap: 8 }}><Server size={17} /> Servidor</h3>
            <span className="small">Ligado há {uptime(d.server.uptime_s)} · memória {Math.round(d.server.rss / 1024 ** 2)} MB · carga {d.server.load[0].toFixed(2)} ({d.server.cpus} CPUs) · reconhecimento facial em {d.server.face_threads} thread(s)</span>
            {disk && (
              <>
                <div className="live-bar"><i style={{ width: `${Math.round(((disk.total - disk.free) / disk.total) * 100)}%`, background: disk.free / disk.total < 0.15 ? 'var(--bad)' : undefined }} /></div>
                <span className="tiny muted">Disco: {gb(disk.total - disk.free)} usados de {gb(disk.total)} · {gb(disk.free)} livres · originais guardados no servidor: {gb(t.server_originals_bytes)}</span>
              </>
            )}
            <span className="tiny muted">
              Faxina de arquivos sem uso: {d.server.sweep ? `${ago(d.server.sweep.at, now)}, ${d.server.sweep.tmp + d.server.sweep.previews} arquivo(s) apagado(s)` : 'roda 3 min depois de ligar e uma vez por dia'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
