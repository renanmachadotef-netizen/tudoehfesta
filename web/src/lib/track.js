// Pixel do Facebook e Google Tag Manager, so depois que o visitante aceita cookies de marketing.
// Sem configuracao no admin, nada e carregado e o aviso de cookies nem aparece.
const KEY = 'tef_consent_v1';
let loaded = false;
// Eventos disparados antes de os rastreadores carregarem (configuracao do site ainda chegando): vao depois.
const pending = [];

export const consent = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch { /* modo privado */ } },
};

export function loadTrackers(site) {
  if (loaded || consent.get() !== 'yes') return;
  const pixel = /^\d{10,20}$/.test(String(site?.fb_pixel || '')) ? site.fb_pixel : null;
  const gtm = /^GTM-[A-Z0-9]{4,12}$/.test(String(site?.gtm_id || '')) ? site.gtm_id : null;
  if (!pixel && !gtm) return;
  loaded = true;
  if (pixel) {
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', pixel);
  }
  if (gtm) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtm.js?id=${gtm}`;
    document.head.appendChild(s);
  }
  for (const [n, d] of pending.splice(0)) send(n, d);
}

// Eventos padrao: PageView, ViewContent (evento), AddToCart, InitiateCheckout, Purchase.
const GA = { PageView: 'page_view', ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', Purchase: 'purchase' };
export function track(name, data = {}) {
  if (loaded) return send(name, data);
  if (consent.get() !== 'no' && pending.length < 20) pending.push([name, data]);
}

function send(name, data) {
  try {
    if (window.fbq) window.fbq('track', name, data.value != null ? { currency: 'BRL', ...data } : data);
    if (window.dataLayer) window.dataLayer.push({ event: GA[name] || name, ...(data.value != null ? { currency: 'BRL' } : {}), ...data });
  } catch { /* nunca quebra o site por causa do rastreio */ }
}
