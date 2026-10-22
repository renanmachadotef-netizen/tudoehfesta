import { useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon } from 'lucide-react';
import { useSite } from '../../lib/site.jsx';
import { dateBR } from '../../lib/format.js';

// Arte de divulgacao (story 1080x1920 ou feed 1080x1350) desenhada no navegador com uma foto do evento,
// nome, data, chamada, endereco e QR Code. Tres modelos na identidade do site.
const FORMATS = { story: [1080, 1920], feed: [1080, 1350] };
const TEMPLATES = [['papel', 'Papel'], ['negativo', 'Negativo'], ['flash', 'Flash']];
const C = { paper: '#F6F0E6', ink: '#1E1915', muted: '#6B5E52', night: '#17120F', accent: '#FF5A1F', amber: '#E8A23A' };

const loadImg = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });

// Desenha a imagem cobrindo a area (como object-fit: cover).
function cover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// Quebra o titulo em ate `max` linhas que caibam na largura.
function lines(ctx, text, width, max = 3) {
  const words = String(text).split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > width && cur) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out.slice(0, max);
}

function fitTitle(ctx, text, width, start, min, maxLines) {
  let size = start;
  for (; size > min; size -= 4) {
    ctx.font = `400 ${size}px Gloock`;
    const ls = lines(ctx, text, width, 99);
    if (ls.length <= maxLines && ls.every((l) => ctx.measureText(l).width <= width)) break;
  }
  ctx.font = `400 ${size}px Gloock`;
  return { size, ls: lines(ctx, text, width, maxLines) };
}

function fitLine(ctx, text, width, start, min, style) {
  let size = start;
  for (; size > min; size -= 2) {
    ctx.font = `${style} ${size}px Gloock`;
    if (ctx.measureText(text).width <= width) break;
  }
  return size;
}

function circleMark(ctx, cx, cy, rx, ry) {
  ctx.save();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = Math.max(6, rx / 18);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, -0.08, 0.15, Math.PI * 2 + 0.6);
  ctx.stroke();
  ctx.restore();
}

async function draw(canvas, { tpl, fmt, photos, event, url, qr }) {
  const [W, H] = FORMATS[fmt];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  await Promise.all(['400 100px Gloock', 'italic 400 100px Gloock', '600 40px "Instrument Sans"', '500 30px "JetBrains Mono"', '600 60px Caveat'].map((f) => document.fonts.load(f).catch(() => {})));
  const imgs = await Promise.all(photos.slice(0, 4).map((p) => loadImg(p.preview).catch(() => null)));
  const main = imgs[0];
  const qrImg = qr ? await loadImg(qr).catch(() => null) : null;
  const story = fmt === 'story';
  const pad = 80;
  const when = [dateBR(event.event_date), event.city].filter(Boolean).join(' · ');

  if (tpl === 'papel') {
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.muted; ctx.font = '500 30px "JetBrains Mono"'; ctx.fillText('FOTOS DISPONÍVEIS', pad, pad + 20);
    // "copia" impressa levemente torta
    const pw = W - pad * 2 - 40;
    const cta = 'Ache suas fotos com uma selfie.';
    const footTop = H - pad - (story ? 220 : 170) - 50;
    const t = fitTitle(ctx, event.title, W - pad * 2, story ? 120 : 96, 56, 2);
    const ctaSize = fitLine(ctx, cta, W - pad * 2, Math.round(t.size * 0.62), 30, 'italic 400');
    const textH = t.ls.length * t.size * 0.98 + ctaSize * 1.5 + 60;
    const py = pad + 70;
    const ph = Math.max(200, Math.min(story ? Math.round(pw * 1.15) : Math.round(pw * 0.72), footTop - textH - py - 140));
    ctx.save();
    ctx.translate(W / 2, py + ph / 2);
    ctx.rotate(-0.025);
    ctx.shadowColor = 'rgba(60,40,25,.28)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
    ctx.fillStyle = '#FFFDF8'; ctx.fillRect(-pw / 2 - 26, -ph / 2 - 26, pw + 52, ph + 110);
    ctx.shadowColor = 'transparent';
    if (main) cover(ctx, main, -pw / 2, -ph / 2, pw, ph); else { ctx.fillStyle = '#5B3B2B'; ctx.fillRect(-pw / 2, -ph / 2, pw, ph); }
    ctx.fillStyle = C.muted; ctx.font = '500 26px "JetBrains Mono"'; ctx.fillText(when.toUpperCase(), -pw / 2, ph / 2 + 58);
    ctx.restore();
    let y = py + ph + 130;
    const { size, ls } = t;
    ctx.font = `400 ${size}px Gloock`;
    ctx.fillStyle = C.ink;
    for (const l of ls) { ctx.fillText(l, pad, y + size * 0.8); y += size * 0.98; }
    ctx.font = `italic 400 ${ctaSize}px Gloock`; ctx.fillStyle = C.accent;
    ctx.fillText(cta, pad, y + ctaSize * 1.1);
    footer(ctx, { W, H, pad, url, qrImg, dark: false, story });
  } else if (tpl === 'negativo') {
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    const sx = pad - 20;
    const sw = W - sx * 2;
    const frames = story ? 3 : 2;
    const sy = story ? 130 : 90;
    const footTop = H - pad - (story ? 220 : 170) - 50;
    const t = fitTitle(ctx, event.title, W - pad * 2, story ? 110 : 88, 52, 2);
    const textH = t.ls.length * t.size * 0.98 + 90;
    const sh = Math.max(400, footTop - textH - sy - 110);
    const fh = Math.round((sh - 120 - (frames - 1) * 28) / frames);
    ctx.save();
    ctx.translate(W / 2, sy + sh / 2); ctx.rotate(-0.03); ctx.translate(-W / 2, -(sy + sh / 2));
    ctx.shadowColor = 'rgba(60,40,25,.3)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
    ctx.fillStyle = C.night; ctx.fillRect(sx, sy, sw, sh);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(246,240,230,.16)';
    for (let x = sx + 30; x < sx + sw - 30; x += 64) { ctx.fillRect(x, sy + 22, 30, 20); ctx.fillRect(x, sy + sh - 42, 30, 20); }
    for (let i = 0; i < frames; i++) {
      const fy = sy + 70 + i * (fh + 28);
      const im = imgs[i] || main;
      if (im) cover(ctx, im, sx + 40, fy, sw - 80, fh); else { ctx.fillStyle = '#5B3B2B'; ctx.fillRect(sx + 40, fy, sw - 80, fh); }
      ctx.fillStyle = C.amber; ctx.font = '500 24px "JetBrains Mono"'; ctx.fillText(`${14 + i}${i % 2 ? 'A' : ''} ▸`, sx + 40, fy + fh + 22);
      if (i === (frames > 2 ? 1 : 0)) circleMark(ctx, W / 2, fy + fh / 2, (sw - 80) / 2 + 26, fh / 2 + 34);
    }
    ctx.restore();
    ctx.fillStyle = C.accent; ctx.font = '600 64px Caveat'; ctx.save(); ctx.translate(W - pad - 300, sy - 10); ctx.rotate(-0.1); ctx.fillText('é você aqui!', 0, 0); ctx.restore();
    let y = sy + sh + 90;
    const { size, ls } = t;
    ctx.font = `400 ${size}px Gloock`;
    ctx.fillStyle = C.ink;
    for (const l of ls) { ctx.fillText(l, pad, y + size * 0.8); y += size * 0.98; }
    ctx.fillStyle = C.muted; ctx.font = '500 28px "JetBrains Mono"'; ctx.fillText(when.toUpperCase(), pad, y + 40);
    footer(ctx, { W, H, pad, url, qrImg, dark: false, story });
  } else {
    ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, H);
    const ph = story ? Math.round(H * 0.5) : Math.round(H * 0.48);
    if (main) cover(ctx, main, 0, 0, W, ph); else { ctx.fillStyle = '#5B3B2B'; ctx.fillRect(0, 0, W, ph); }
    ctx.fillStyle = C.night; ctx.font = '500 30px "JetBrains Mono"'; ctx.fillText('FOTOS DISPONÍVEIS', pad, ph + 90);
    let y = ph + 130;
    const { size, ls } = fitTitle(ctx, event.title, W - pad * 2, story ? 130 : 100, 56, 3);
    ctx.fillStyle = C.night;
    for (const l of ls) { ctx.fillText(l, pad, y + size * 0.8); y += size * 0.96; }
    ctx.font = `italic 400 ${Math.round(size * 0.55)}px Gloock`;
    ctx.fillText('Tire uma selfie e ache as suas.', pad, y + size * 0.55);
    ctx.font = '500 28px "JetBrains Mono"'; ctx.fillText(when.toUpperCase(), pad, y + size * 0.55 + 60);
    footer(ctx, { W, H, pad, url, qrImg, dark: true, story });
  }
}

function footer(ctx, { W, H, pad, url, qrImg, dark, story }) {
  const q = story ? 220 : 170;
  const y = H - pad - q;
  if (qrImg) {
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(W - pad - q - 16, y - 16, q + 32, q + 32);
    ctx.drawImage(qrImg, W - pad - q, y, q, q);
  }
  ctx.fillStyle = dark ? C.night : C.ink;
  ctx.font = '400 54px Gloock';
  ctx.fillText('Tudo Eh ', pad, H - pad - 60);
  const w = ctx.measureText('Tudo Eh ').width;
  ctx.font = 'italic 400 54px Gloock'; ctx.fillStyle = dark ? '#FFFDF8' : C.accent; ctx.fillText('Festa', pad + w, H - pad - 60);
  ctx.fillStyle = dark ? C.night : C.muted; ctx.font = '500 28px "JetBrains Mono"';
  ctx.fillText(url.replace(/^https?:\/\//, ''), pad, H - pad - 10, W - pad * 2 - q - 40);
}

export default function ArtEditor({ event, photos }) {
  const { toast } = useSite();
  const ref = useRef(null);
  const [tpl, setTpl] = useState('papel');
  const [fmt, setFmt] = useState('story');
  const [pick, setPick] = useState([]);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const url = `${window.location.origin}/evento/${event.slug}`;
  const usable = photos.filter((p) => !p.hidden && !p.pending);
  const chosen = (pick.length ? pick.map((id) => usable.find((p) => p.id === id)).filter(Boolean) : [])
    .concat(usable.filter((p) => !pick.includes(p.id) && (p.id === event.cover_photo_id)))
    .concat(usable.filter((p) => !pick.includes(p.id) && p.id !== event.cover_photo_id))
    .slice(0, 4);

  useEffect(() => {
    import('qrcode').then((m) => m.default.toDataURL(url, { width: 600, margin: 1, color: { dark: '#17120F' } })).then(setQr).catch(() => {});
  }, [url]);
  const key = `${tpl}|${fmt}|${chosen.map((p) => p.id).join(',')}|${qr ? 1 : 0}`;
  useEffect(() => {
    if (!ref.current) return;
    setBusy(true);
    draw(ref.current, { tpl, fmt, photos: chosen, event, url, qr }).catch(() => {}).finally(() => setBusy(false));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (p) => setPick((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id].slice(-4)));
  const download = () => ref.current.toBlob((b) => {
    if (!b) return toast('Não foi possível gerar a imagem');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `${event.slug}-${fmt}-${tpl}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');

  return (
    <div className="card stack" style={{ gap: 14 }}>
      <h3 className="row" style={{ gap: 8 }}><ImageIcon size={18} /> Arte para Instagram e WhatsApp</h3>
      <div className="art-editor">
        <div className="art-preview" style={{ aspectRatio: `${FORMATS[fmt][0]} / ${FORMATS[fmt][1]}` }}>
          <canvas ref={ref} aria-label={`Arte ${fmt} do evento ${event.title}`} />
          {busy && <span className="art-busy">desenhando…</span>}
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Formato</b>
            <div className="chips">
              <button className={`chip${fmt === 'story' ? ' active' : ''}`} onClick={() => setFmt('story')}>Story 9:16</button>
              <button className={`chip${fmt === 'feed' ? ' active' : ''}`} onClick={() => setFmt('feed')}>Feed 4:5</button>
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Modelo</b>
            <div className="chips">{TEMPLATES.map(([k, l]) => <button key={k} className={`chip${tpl === k ? ' active' : ''}`} onClick={() => setTpl(k)}>{l}</button>)}</div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Fotos da arte <span className="muted" style={{ fontWeight: 400 }}>(toque para escolher, até 4)</span></b>
            <div className="art-pick">
              {usable.slice(0, 40).map((p) => (
                <button key={p.id} className={chosen.some((c) => c.id === p.id) ? 'on' : ''} onClick={() => toggle(p)} aria-label="Usar esta foto na arte">
                  <img src={p.thumb} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }} onClick={download} disabled={busy}><Download size={16} /> Baixar imagem</button>
          <span className="tiny muted">As fotos saem com a marca d’água do evento. Poste no story com o link do evento ou mande no grupo do WhatsApp.</span>
        </div>
      </div>
    </div>
  );
}
