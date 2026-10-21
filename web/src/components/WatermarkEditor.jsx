import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Type } from 'lucide-react';
import { uploadWithProgress } from '../lib/api.js';

const LAYOUTS = [
  ['tiled', 'Repetida na diagonal', 'Mais proteção contra print e recorte.'],
  ['center', 'No centro', 'Uma marca grande no meio da foto.'],
  ['corner', 'No canto', 'Discreta, no canto inferior direito.'],
];

// Editor de marca d'agua com previa ao vivo. base = '/admin' ou '/studio' (rotas de imagem e previa).
export default function WatermarkEditor({ value, base, onSave, saving, extra }) {
  const [wm, setWm] = useState(value);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const timer = useRef();
  const fileRef = useRef();

  useEffect(() => { setWm(value); }, [value]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api${base}/watermark/preview`, {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watermark: wm }),
        });
        if (!res.ok) return;
        const url = URL.createObjectURL(await res.blob());
        setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
      } catch { /* previa e opcional */ }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [wm, base]);

  const set = (patch) => setWm((w) => ({ ...w, ...patch }));
  const uploadLogo = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    const fd = new FormData();
    fd.append('file', f);
    try {
      const d = await uploadWithProgress(`${base}/watermark/image`, fd);
      set({ type: 'image', image: d.url });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="wm-editor">
      <div className="stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <button type="button" className={`btn grow ${wm.type === 'text' ? '' : 'btn-ghost'}`} onClick={() => set({ type: 'text' })}><Type size={16} /> Texto</button>
          <button type="button" className={`btn grow ${wm.type === 'image' ? '' : 'btn-ghost'}`} onClick={() => (wm.image ? set({ type: 'image' }) : fileRef.current?.click())}><ImagePlus size={16} /> Logo (PNG)</button>
        </div>
        {wm.type === 'text' ? (
          <label className="field"><span>Texto da marca</span><input className="input" maxLength={60} value={wm.text} onChange={(e) => set({ text: e.target.value })} /></label>
        ) : (
          <div className="row">
            {wm.image && <img src={wm.image} alt="" style={{ height: 44, maxWidth: 160, objectFit: 'contain', background: 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/14px 14px', borderRadius: 6, padding: 4 }} />}
            <button type="button" className="btn btn-sm btn-soft" onClick={() => fileRef.current?.click()}>Trocar logo</button>
            <span className="tiny muted">PNG com fundo transparente fica melhor.</span>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/webp" hidden onChange={uploadLogo} />
        <label className="field"><span>Transparência: {Math.round(wm.opacity * 100)}% visível</span>
          <input type="range" min="0.05" max="1" step="0.05" value={wm.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
        </label>
        <div className="field"><span>Posição</span>
          {LAYOUTS.map(([k, label, hint]) => (
            <label key={k} className="check"><input type="radio" name={`layout-${base}`} checked={wm.layout === k} onChange={() => set({ layout: k })} /><span><b>{label}</b> <span className="muted">· {hint}</span></span></label>
          ))}
        </div>
        {error && <div className="alert alert-bad">{error}</div>}
        {extra}
        <button type="button" className="btn btn-accent" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={() => onSave(wm)}>{saving ? 'Salvando…' : 'Salvar marca d’água'}</button>
      </div>
      <div className="wm-preview">
        {preview ? <img src={preview} alt="Prévia da marca d'água" /> : <div className="skeleton" style={{ aspectRatio: '3/2', borderRadius: 12 }} />}
        <span className="tiny muted">Prévia. As fotos à venda usam esta marca na vitrine; quem compra recebe o original sem marca.</span>
      </div>
    </div>
  );
}
