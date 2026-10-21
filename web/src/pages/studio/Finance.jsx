import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useApi, useSite } from '../../lib/site.jsx';
import { money, dateTimeBR, centsToInput } from '../../lib/format.js';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import { PageHead } from './Studio.jsx';

const PAYOUT = { requested: ['Solicitado', 'badge-warn'], paid: ['Pago', 'badge-ok'], rejected: ['Recusado', 'badge-bad'] };

export default function Finance() {
  const { toast } = useSite();
  const { data, loading, error, reload } = useApi('/studio/finance');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { balance, payouts, pix_key: pix, commission_pct: pct, min_payout_cents: min } = data;

  const request = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/studio/payouts', { method: 'POST', body: { amount: amount || centsToInput(balance.available) } });
      toast('Saque solicitado!');
      setAmount('');
      reload();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead title="Financeiro" />
      <div className="kpis">
        <div className="kpi accent"><span>Disponível para saque</span><b>{money(balance.available)}</b></div>
        <div className="kpi"><span>A liberar</span><b>{money(balance.pending)}</b><small>vendas dos últimos {balance.release_days} dias (prazo de estorno)</small></div>
        <div className="kpi"><span>Saques em análise</span><b>{money(balance.requested)}</b></div>
        <div className="kpi"><span>Já recebido</span><b>{money(balance.paid_out)}</b></div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="card stack" onSubmit={request}>
          <h3>Pedir saque via Pix</h3>
          {pix ? <p className="small muted">Vai para a chave <b>{pix}</b>. <Link to="/painel/perfil" style={{ textDecoration: 'underline' }}>Alterar</Link></p>
            : <div className="alert alert-warn">Cadastre sua chave Pix no <Link to="/painel/perfil" style={{ textDecoration: 'underline' }}>perfil</Link> para sacar.</div>}
          <label className="field"><span>Valor (R$)</span><input className="input" inputMode="decimal" placeholder={centsToInput(balance.available)} value={amount} onChange={(e) => setAmount(e.target.value)} /><small>Mínimo {money(min)}. Em branco = saldo todo.</small></label>
          <button className="btn btn-accent" disabled={busy || !pix || balance.available < min}>Solicitar saque</button>
        </form>
        <div className="card-flat stack small">
          <b>Como funciona</b>
          <p className="muted">A cada venda, a plataforma fica com <b>{pct}%</b> (pagamento, servidor, reconhecimento facial e divulgação) e o restante é seu.</p>
          <p className="muted">O valor fica “a liberar” por {balance.release_days} dias, prazo para estornos. Depois vai para o saldo disponível e você pode sacar quando quiser.</p>
          <p className="muted">Os saques são pagos via Pix em até 2 dias úteis.</p>
        </div>
      </div>

      <h3>Histórico de saques</h3>
      {payouts.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Pedido em</th><th>Chave</th><th>Status</th><th>Pago em</th><th className="num">Valor</th></tr></thead>
          <tbody>{payouts.map((p) => (
            <tr key={p.id}><td className="small">{dateTimeBR(p.requested_at)}</td><td className="small">{p.pix_key}</td>
              <td><span className={`badge ${PAYOUT[p.status][1]}`}>{PAYOUT[p.status][0]}</span>{p.note && <div className="tiny muted">{p.note}</div>}</td>
              <td className="small">{dateTimeBR(p.paid_at)}</td><td className="num">{money(p.amount_cents)}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted small">Nenhum saque ainda.</p>}
    </div>
  );
}
