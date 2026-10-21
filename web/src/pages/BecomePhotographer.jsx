import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ScanFace, Wallet, QrCode, TrendingUp, Tag, Zap } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSite, useTitle } from '../lib/site.jsx';
import { money } from '../lib/format.js';

const FEATURES = [
  [ScanFace, 'Reconhecimento facial ilimitado', 'O rosto de cada pessoa é indexado no upload. O cliente tira uma selfie e cai direto nas fotos dele: mais vendas, menos garimpo.'],
  [Tag, 'Seu preço, suas regras', 'Preço por foto, desconto progressivo (ex.: 5+ fotos = 20% off), pacote com teto por evento e cupons.'],
  [TrendingUp, 'Painel de gestão', 'Vendas do dia, do mês, eventos que mais vendem, conversão por visita e histórico de cada pedido.'],
  [Wallet, 'Saque via Pix', 'Acompanhe saldo liberado e a liberar. Peça o saque quando quiser direto para a sua chave Pix.'],
  [QrCode, 'Kit de divulgação', 'Link e QR Code de cada evento para colocar no telão, no flyer ou no grupo do WhatsApp.'],
  [Zap, 'Rápido de publicar', 'Arraste a pasta de fotos: miniaturas, marca d’água e rostos são processados automaticamente.'],
];

function Simulator({ pct }) {
  const [buyers, setBuyers] = useState(60);
  const [avg, setAvg] = useState(45);
  const gross = buyers * avg * 100;
  const net = Math.round(gross * (1 - pct / 100));
  return (
    <div className="card stack">
      <h3>Simule um evento</h3>
      <label className="field"><span>Pessoas que compram: <b>{buyers}</b></span><input type="range" min="5" max="400" value={buyers} onChange={(e) => setBuyers(+e.target.value)} /></label>
      <label className="field"><span>Gasto médio por pessoa: <b>{money(avg * 100)}</b></span><input type="range" min="10" max="200" step="5" value={avg} onChange={(e) => setAvg(+e.target.value)} /></label>
      <div className="row between card-flat"><span className="muted small">Você recebe</span><b style={{ fontSize: 26 }}>{money(net)}</b></div>
      <span className="tiny muted">Estimativa com comissão de {pct}% da plataforma. Não inclui impostos.</span>
    </div>
  );
}

export default function BecomePhotographer() {
  useTitle('Venda suas fotos');
  const { user, refresh, commission_pct: commission } = useSite();
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '', display_name: '', city: '', instagram: '', whatsapp: '', camera: '', bio: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isPhotographer = user?.role === 'photographer' || user?.role === 'admin';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/photographer', { method: 'POST', body: f });
      await refresh();
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="hero">
        <div className="container"><div className="hero-inner" style={{ padding: '70px 0 60px' }}>
          <span className="eyebrow">Fotógrafos parceiros</span>
          <h1>Fotografe. Publique. <b>Venda no automático.</b></h1>
          <p className="lead">Uma plataforma regional, feita para fotógrafos do Extremo Sul Catarinense ganharem uma renda extra com cada evento.</p>
          <div className="row"><a href="#cadastro" className="btn btn-accent btn-lg">Quero me cadastrar</a></div>
        </div></div>
      </section>

      <section className="section">
        <div className="container stack" style={{ gap: 26 }}>
          <h2>Tudo que você precisa para vender mais</h2>
          <div className="grid-3">
            {FEATURES.map(([Icon, t, d]) => (
              <div key={t} className="step"><Icon size={24} color="var(--accent)" /><h3>{t}</h3><p className="muted small">{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-sm" id="cadastro">
        <div className="container grid-2" style={{ alignItems: 'start', gap: 28 }}>
          <div className="stack">
            <h2>Como funciona</h2>
            <ul className="stack small" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 10 }}>
              {['Cadastro grátis e sem mensalidade', 'Você só paga comissão quando vende', 'Aprovação do cadastro em até 1 dia útil', 'Cliente paga por Pix ou cartão, a plataforma cuida do pagamento e da entrega', 'Saldo liberado após o prazo de segurança e saque via Pix'].map((t) => (
                <li key={t} className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Check size={18} color="var(--ok)" style={{ flex: 'none' }} /> {t}</li>
              ))}
            </ul>
            <Simulator pct={commission ?? 15} />
          </div>

          <div className="card stack" style={{ padding: 26 }}>
            {done || (isPhotographer && user?.photographer_status) ? (
              <div className="stack">
                <h2>Cadastro recebido!</h2>
                {user?.photographer_status === 'approved' ? (
                  <><p className="muted">Seu cadastro está aprovado. Bora publicar o primeiro evento?</p><Link to="/painel" className="btn btn-accent">Abrir meu painel</Link></>
                ) : (
                  <><p className="muted">Vamos analisar e liberar seu acesso em breve. Enquanto isso, complete seu perfil e cadastre sua chave Pix.</p><Link to="/painel/perfil" className="btn">Completar perfil</Link></>
                )}
              </div>
            ) : (
              <form className="stack" onSubmit={submit}>
                <h2>Cadastro de fotógrafo</h2>
                {!user && (
                  <>
                    <div className="grid-2">
                      <label className="field"><span>Seu nome</span><input className="input" required value={f.name} onChange={set('name')} /></label>
                      <label className="field"><span>WhatsApp</span><input className="input" required value={f.whatsapp} onChange={set('whatsapp')} inputMode="tel" /></label>
                    </div>
                    <label className="field"><span>E-mail</span><input className="input" type="email" required value={f.email} onChange={set('email')} /></label>
                    <label className="field"><span>Senha</span><input className="input" type="password" required minLength={6} value={f.password} onChange={set('password')} /></label>
                  </>
                )}
                {user && <p className="small muted">Você está entrando como <b>{user.email}</b>.</p>}
                <label className="field"><span>Nome artístico ou do estúdio</span><input className="input" required value={f.display_name} onChange={set('display_name')} /></label>
                <div className="grid-2">
                  <label className="field"><span>Cidade</span><input className="input" value={f.city} onChange={set('city')} placeholder="Araranguá, SC" /></label>
                  <label className="field"><span>Instagram</span><input className="input" value={f.instagram} onChange={set('instagram')} placeholder="@seuperfil" /></label>
                </div>
                {user && <label className="field"><span>WhatsApp</span><input className="input" value={f.whatsapp} onChange={set('whatsapp')} /></label>}
                <label className="field"><span>Equipamento</span><input className="input" value={f.camera} onChange={set('camera')} placeholder="Ex.: Canon R6, Nikon D750" /></label>
                <label className="field"><span>Conte um pouco do seu trabalho</span><textarea className="textarea" value={f.bio} onChange={set('bio')} placeholder="Que tipo de evento você fotografa, há quanto tempo…" /></label>
                {error && <div className="alert alert-bad">{error}</div>}
                <button className="btn btn-accent btn-lg" disabled={busy}>{busy ? 'Enviando…' : 'Enviar cadastro'}</button>
                <span className="tiny muted">Ao se cadastrar você concorda com os <Link to="/termos" style={{ textDecoration: 'underline' }}>termos de uso</Link>.</span>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
