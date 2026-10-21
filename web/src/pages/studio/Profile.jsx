import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { api, uploadWithProgress } from '../../lib/api.js';
import { useSite } from '../../lib/site.jsx';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import { PageHead } from './Studio.jsx';

export default function Profile() {
  const { toast, user } = useSite();
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const file = useRef();

  useEffect(() => {
    api('/studio/profile').then((d) => setF(d.profile)).catch(setError);
  }, []);

  if (error) return <ErrorBox error={error} />;
  if (!f) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/studio/profile', { method: 'PUT', body: f });
      toast('Perfil salvo');
    } catch (err) {
      toast(err.message);
    }
  };
  const avatar = async (e) => {
    const fl = e.target.files?.[0];
    if (!fl) return;
    const form = new FormData();
    form.append('file', fl);
    try {
      const d = await uploadWithProgress('/studio/profile/avatar', form);
      setF({ ...f, avatar_path: d.url });
    } catch (err) {
      toast(err.message);
    }
  };

  return (
    <form className="stack" style={{ gap: 18, maxWidth: 760 }} onSubmit={save}>
      <PageHead title="Perfil e Pix" />
      <div className="card row" style={{ gap: 18 }}>
        <button type="button" onClick={() => file.current?.click()} style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer' }} aria-label="Trocar foto">
          {f.avatar_path ? <img src={f.avatar_path} alt="" style={{ width: 84, height: 84, borderRadius: 99, objectFit: 'cover' }} />
            : <div style={{ width: 84, height: 84, borderRadius: 99, background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }}><Camera /></div>}
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={avatar} />
        <div className="stack" style={{ gap: 4 }}>
          <b>{f.display_name}</b>
          <span className="small muted">{user?.email}</span>
          {f.status === 'approved' && <a className="small" href={`/fotografo/${f.slug}`} style={{ textDecoration: 'underline' }}>Ver minha página pública</a>}
        </div>
      </div>
      <div className="card stack">
        <div className="grid-2">
          <label className="field"><span>Nome artístico / estúdio</span><input className="input" value={f.display_name || ''} onChange={set('display_name')} /></label>
          <label className="field"><span>Cidade</span><input className="input" value={f.city || ''} onChange={set('city')} /></label>
          <label className="field"><span>Instagram</span><input className="input" value={f.instagram || ''} onChange={set('instagram')} /></label>
          <label className="field"><span>WhatsApp (para contratações)</span><input className="input" value={f.whatsapp || ''} onChange={set('whatsapp')} /></label>
        </div>
        <label className="field"><span>Equipamento</span><input className="input" value={f.camera || ''} onChange={set('camera')} /></label>
        <label className="field"><span>Sobre você</span><textarea className="textarea" value={f.bio || ''} onChange={set('bio')} /></label>
      </div>
      <div className="card stack">
        <h3>Recebimento</h3>
        <div className="grid-2" style={{ gridTemplateColumns: '180px 1fr' }}>
          <label className="field"><span>Tipo de chave</span>
            <select className="select" value={f.pix_key_type || ''} onChange={set('pix_key_type')}>
              <option value="">Escolha…</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option>
              <option value="email">E-mail</option><option value="telefone">Telefone</option><option value="aleatoria">Aleatória</option>
            </select>
          </label>
          <label className="field"><span>Chave Pix</span><input className="input" value={f.pix_key || ''} onChange={set('pix_key')} /></label>
        </div>
      </div>
      <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }}>Salvar perfil</button>
    </form>
  );
}
