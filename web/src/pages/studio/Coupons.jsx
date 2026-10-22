import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi, useSite } from '../../lib/site.jsx';
import { dateBR, money } from '../../lib/format.js';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import { PageHead } from './Studio.jsx';

const emptyRule = { kind: 'pct', pct: 10, amount: '', free_photos: 1, event_id: '', max_uses: '', starts_at: '', ends_at: '' };
const ruleLabel = (c) => (c.kind === 'fixed' ? `${money(c.amount_cents)} no pedido` : c.kind === 'free' ? `${c.free_photos} foto${c.free_photos === 1 ? '' : 's'} grátis` : `${c.pct}% off`);
const validity = (c) => (c.starts_at || c.ends_at ? `${c.starts_at ? dateBR(c.starts_at) : '…'} → ${c.ends_at ? dateBR(c.ends_at) : '…'}` : 'sempre');

// Regra comum ao cupom individual e ao lote: tipo, valor, evento, validade.
function RuleFields({ f, setF, events, usesLabel = 'Limite de usos', usesPlaceholder = '∞' }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <div className="grid-3">
        <label className="field"><span>Tipo</span>
          <select className="select" value={f.kind} onChange={set('kind')}>
            <option value="pct">% de desconto</option>
            <option value="fixed">Valor em R$ no pedido</option>
            <option value="free">Fotos grátis</option>
          </select>
        </label>
        {f.kind === 'pct' && <label className="field"><span>% off</span><input className="input" type="number" min="1" max="100" required value={f.pct} onChange={set('pct')} /></label>}
        {f.kind === 'fixed' && <label className="field"><span>Desconto (R$)</span><input className="input" inputMode="decimal" required value={f.amount} onChange={set('amount')} placeholder="10,00" /></label>}
        {f.kind === 'free' && <label className="field"><span>Quantas fotos grátis</span><input className="input" type="number" min="1" max="500" required value={f.free_photos} onChange={set('free_photos')} /><small>As mais baratas do carrinho saem de graça.</small></label>}
        <label className="field"><span>Evento</span>
          <select className="select" value={f.event_id} onChange={set('event_id')}>
            <option value="">Todos os meus eventos</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </label>
      </div>
      <div className="grid-3">
        <label className="field"><span>Válido a partir de</span><input className="input" type="date" value={f.starts_at} onChange={set('starts_at')} /></label>
        <label className="field"><span>Válido até</span><input className="input" type="date" value={f.ends_at} onChange={set('ends_at')} /></label>
        <label className="field"><span>{usesLabel}</span><input className="input" type="number" min="1" value={f.max_uses} onChange={set('max_uses')} placeholder={usesPlaceholder} /></label>
      </div>
    </>
  );
}

export default function Coupons() {
  const { toast } = useSite();
  const { data, loading, error, reload } = useApi('/studio/coupons');
  const events = useApi('/studio/events');
  const evList = (events.data?.events || []).filter((e) => e.kind !== 'pool');
  const [mode, setMode] = useState('single');
  const [f, setF] = useState({ ...emptyRule, code: '' });
  const [b, setB] = useState({ ...emptyRule, prefix: '', count: 20 });
  const [lastBatch, setLastBatch] = useState(null);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api('/studio/coupons', { method: 'POST', body: f });
      toast('Cupom criado');
      setF({ ...emptyRule, code: '' });
      reload();
    } catch (err) { toast(err.message); }
  };
  const createBatch = async (e) => {
    e.preventDefault();
    try {
      const d = await api('/studio/coupons/batch', { method: 'POST', body: b });
      toast(`${d.codes.length} cupons criados`);
      setLastBatch(d.batch);
      reload();
    } catch (err) { toast(err.message); }
  };
  const toggle = async (c) => {
    await api(`/studio/coupons/${c.id}`, { method: 'PUT', body: { active: !c.active } });
    reload();
  };
  const coupons = data?.coupons || [];
  const single = coupons.filter((c) => !c.batch);
  const batches = [];
  for (const c of coupons.filter((x) => x.batch)) {
    let g = batches.find((x) => x.batch === c.batch);
    if (!g) batches.push((g = { batch: c.batch, sample: c, count: 0, used: 0 }));
    g.count++;
    g.used += c.uses > 0 ? 1 : 0;
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead title="Cupons de desconto" />
      <div className="tabs">
        <button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>Cupom</button>
        <button className={mode === 'batch' ? 'active' : ''} onClick={() => setMode('batch')}>Lote de cupons</button>
      </div>
      {mode === 'single' ? (
        <form className="card stack" onSubmit={create}>
          <p className="small muted">Um código para divulgar no Instagram, mandar para um grupo ou recuperar um cliente. Vale só para os seus eventos.</p>
          <label className="field" style={{ maxWidth: 320 }}><span>Código</span><input className="input" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="FORMATURA10" style={{ textTransform: 'uppercase' }} /></label>
          <RuleFields f={f} setF={setF} events={evList} />
          <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }}>Criar cupom</button>
        </form>
      ) : (
        <form className="card stack" onSubmit={createBatch}>
          <p className="small muted">Vários códigos diferentes de uma vez, cada um de uso único: por exemplo, um para cada formando ou cada convidado. Depois baixe a lista em planilha.</p>
          <div className="grid-2">
            <label className="field"><span>Prefixo</span><input className="input" required value={b.prefix} onChange={(e) => setB({ ...b, prefix: e.target.value })} placeholder="CEJA" style={{ textTransform: 'uppercase' }} /><small>Os códigos ficam como {(b.prefix || 'CEJA').toUpperCase()}7KQ2M.</small></label>
            <label className="field"><span>Quantidade</span><input className="input" type="number" min="1" max="500" required value={b.count} onChange={(e) => setB({ ...b, count: e.target.value })} /></label>
          </div>
          <RuleFields f={b} setF={setB} events={evList} usesLabel="Usos por código" usesPlaceholder="1" />
          <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }}>Gerar cupons</button>
          {lastBatch && <a className="btn btn-sm btn-soft" style={{ alignSelf: 'flex-start' }} href={`/api/studio/coupons/batch.csv?batch=${encodeURIComponent(lastBatch)}`}><Download size={14} /> Baixar os códigos (CSV)</a>}
        </form>
      )}

      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : (
        <>
          {single.length > 0 && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Código</th><th>Desconto</th><th>Evento</th><th>Validade</th><th className="num">Usos</th><th></th></tr></thead>
              <tbody>{single.map((c) => (
                <tr key={c.id} style={{ opacity: c.active ? 1 : 0.5 }}>
                  <td><b>{c.code}</b><div className="tiny muted">criado em {dateBR(c.created_at)}</div></td>
                  <td>{ruleLabel(c)}</td><td className="small">{c.event_title || 'Todos'}</td><td className="small">{validity(c)}</td>
                  <td className="num">{c.uses}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => toggle(c)}>{c.active ? 'Desativar' : 'Ativar'}</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {batches.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <h3>Lotes</h3>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Lote</th><th>Desconto</th><th>Evento</th><th>Validade</th><th className="num">Usados</th><th></th></tr></thead>
                <tbody>{batches.map((g) => (
                  <tr key={g.batch}>
                    <td><b>{g.batch}</b><div className="tiny muted">{g.count} códigos</div></td>
                    <td>{ruleLabel(g.sample)}</td><td className="small">{g.sample.event_title || 'Todos'}</td><td className="small">{validity(g.sample)}</td>
                    <td className="num">{g.used} / {g.count}</td>
                    <td><a className="btn btn-sm btn-ghost" href={`/api/studio/coupons/batch.csv?batch=${encodeURIComponent(g.batch)}`}><Download size={14} /> CSV</a></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
