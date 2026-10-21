import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useApi, useSite } from '../../lib/site.jsx';
import { Loading, ErrorBox } from '../../components/Layout.jsx';
import WatermarkEditor from '../../components/WatermarkEditor.jsx';
import { PageHead } from './Studio.jsx';

export default function Watermark() {
  const { toast } = useSite();
  const { data, loading, error, reload } = useApi('/studio/watermark');
  const [saving, setSaving] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const save = async (wm) => {
    setSaving(true);
    try {
      const d = await api('/studio/watermark', { method: 'PUT', body: { watermark: wm } });
      toast(d.rerender ? `Marca salva. Refazendo ${d.rerender} vitrines…` : 'Marca salva');
      reload();
    } catch (err) {
      toast(err.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!confirm('Voltar a usar a marca d’água padrão do site nos eventos marcados com “Minha marca”?')) return;
    await api('/studio/watermark', { method: 'PUT', body: { watermark: null } });
    toast('Usando a marca do site');
    reload();
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Minha marca d’água" />
      <div className="card-flat small stack" style={{ gap: 6 }}>
        <p>Cada evento escolhe a marca em <b>Eventos → editar → Marca d’água</b>:</p>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 2 }} className="muted">
          <li><b>Padrão do site</b>: a marca Tudo Eh Festa.</li>
          <li><b>Minha marca</b>: a que você configurar aqui (sem configurar, usa a do site).</li>
          <li><b>Sem marca d’água</b>: a vitrine sai limpa, mas continua em resolução reduzida. O original só vai para quem compra.</li>
        </ul>
      </div>
      <div className="card">
        <WatermarkEditor
          base="/studio"
          value={data.watermark || { ...data.site }}
          saving={saving}
          onSave={save}
          extra={data.watermark && <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={remove}>Apagar minha marca</button>}
        />
      </div>
    </div>
  );
}
