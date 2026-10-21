import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useSite, useTitle } from '../lib/site.jsx';

export function AuthForm({ initial = 'login', onDone }) {
  const { refresh } = useSite();
  const [mode, setMode] = useState(initial);
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body: f });
      await refresh();
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="tabs">
        <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Já tenho conta</button>
        <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Criar conta</button>
      </div>
      {mode === 'register' && (
        <>
          <label className="field"><span>Nome completo</span><input className="input" required value={f.name} onChange={set('name')} autoComplete="name" /></label>
          <label className="field"><span>WhatsApp <small>(opcional, para suporte)</small></span><input className="input" value={f.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" /></label>
        </>
      )}
      <label className="field"><span>E-mail</span><input className="input" type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></label>
      <label className="field"><span>Senha</span><input className="input" type="password" required minLength={6} value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
      {error && <div className="alert alert-bad">{error}</div>}
      <button className="btn btn-accent btn-lg" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
      {mode === 'login' && <p className="tiny muted center">Esqueceu a senha? Fale com a gente pelo WhatsApp que liberamos uma nova.</p>}
    </form>
  );
}

export default function Auth({ mode }) {
  useTitle(mode === 'login' ? 'Entrar' : 'Criar conta');
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('voltar') || '/minhas-fotos';
  return (
    <div className="container">
      <div className="auth-wrap card stack" style={{ padding: 28 }}>
        <h2>{mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}</h2>
        <p className="muted small">Sua conta guarda suas fotos compradas para baixar quando quiser.</p>
        <AuthForm initial={mode} onDone={() => nav(next)} />
        <p className="small muted center">É fotógrafo? <Link to="/seja-fotografo" style={{ textDecoration: 'underline' }}>Cadastre-se como parceiro</Link></p>
      </div>
    </div>
  );
}
