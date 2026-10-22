import { useSyncExternalStore } from 'react';

// Carrinho no aparelho (localStorage): lista de fotos + dados minimos para desenhar a miniatura.
const KEY = 'tef_carrinho_v1';
let state = load();
const subs = new Set();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { items: Array.isArray(s.items) ? s.items : [], coupon: s.coupon || '' };
  } catch {
    return { items: [], coupon: '' };
  }
}
function save(next) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* modo privado */ }
  subs.forEach((f) => f());
}
window.addEventListener('storage', (e) => {
  if (e.key === KEY) { state = load(); subs.forEach((f) => f()); }
});

const pick = (p) => ({ id: p.id, event_id: p.event_id, thumb: p.thumb, event_title: p.event_title, event_slug: p.event_slug });

export const cart = {
  get: () => state,
  has: (id) => state.items.some((i) => i.id === id),
  add(photos) {
    const list = Array.isArray(photos) ? photos : [photos];
    const ids = new Set(state.items.map((i) => i.id));
    save({ ...state, items: [...state.items, ...list.filter((p) => !ids.has(p.id)).map(pick)] });
  },
  remove(ids) {
    const drop = new Set(Array.isArray(ids) ? ids : [ids]);
    save({ ...state, items: state.items.filter((i) => !drop.has(i.id)) });
  },
  toggle(photo) {
    if (cart.has(photo.id)) cart.remove(photo.id);
    else cart.add(photo);
  },
  setCoupon: (coupon) => save({ ...state, coupon }),
  clear: () => save({ items: [], coupon: '' }),
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};

// Quem esta logado tem o carrinho salvo no servidor: segue a pessoa entre aparelhos e permite que a loja
// lembre quem deixou fotos esperando. Chamado pelo layout quando o usuario muda.
let syncTimer = null;
let unsubSync = null;
export async function attachCartSync(user, api) {
  if (unsubSync) { unsubSync(); unsubSync = null; }
  if (!user) return;
  try {
    const d = await api('/my/cart');
    if (d.photos?.length) cart.add(d.photos);
  } catch { /* sem rede: segue so no aparelho */ }
  const push = () => api('/my/cart', { method: 'PUT', body: { ids: state.items.map((i) => i.id) } }).catch(() => {});
  push();
  unsubSync = cart.subscribe(() => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(push, 1200);
  });
}

export function useCart() {
  return useSyncExternalStore(cart.subscribe, cart.get);
}
