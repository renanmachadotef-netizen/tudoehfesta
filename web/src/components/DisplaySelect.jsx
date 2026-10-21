import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSite } from '../lib/site.jsx';

// Como um grupo de fotos aparece no site. "Acervo": so pela busca por selfie (no ano), sem pagina.
// "Evento": tem pagina e aparece na lista de eventos/categoria; a galeria pode ser aberta ou so por selfie.
export const DISPLAY = [
  ['pool', 'Só no acervo (selfie)'],
  ['selfie', 'Evento · só por selfie'],
  ['gallery', 'Evento · galeria aberta'],
];
export const displayOf = (e) => (e.kind === 'pool' ? 'pool' : e.hide_gallery ? 'selfie' : 'gallery');

export default function DisplaySelect({ event, onChanged, small }) {
  const { categories = [], toast, refresh } = useSite();
  const [busy, setBusy] = useState(false);
  const display = displayOf(event);
  const save = async (body) => {
    setBusy(true);
    try {
      await api(`/studio/events/${event.id}/display`, { method: 'PUT', body: { display, category_id: event.category_id || null, ...body } });
      toast('Exibição atualizada');
      refresh?.();
      onChanged?.();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const style = small ? { height: 32, fontSize: 13 } : undefined;
  return (
    <div className="row" style={{ gap: 6, flexWrap: small ? 'nowrap' : 'wrap' }}>
      <select className="select" style={{ ...style, width: small ? 190 : 230 }} value={display} disabled={busy} onChange={(e) => save({ display: e.target.value })}>
        {DISPLAY.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {display !== 'pool' && (
        <select className="select" style={{ ...style, width: small ? 140 : 190 }} value={event.category_id || ''} disabled={busy} onChange={(e) => save({ category_id: e.target.value || null })}>
          <option value="">Sem categoria</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </div>
  );
}
