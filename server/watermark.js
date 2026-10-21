import path from 'node:path';
import sharp from 'sharp';
import { db } from './db.js';
import { config } from './config.js';
import { getSetting } from './pricing.js';
import { dirs } from './storage.js';

// Marca d'agua = { type: 'text'|'image', text, image (/m/a/...), opacity 0.05-1, layout: 'tiled'|'center'|'corner' }
// Evento escolhe: 'site' (padrao do admin), 'photographer' (a do fotografo; cai na do site se ele nao tiver) ou 'none'.

export const LAYOUTS = ['tiled', 'center', 'corner'];

export function normalizeWatermark(w, fallbackText = config.watermarkText) {
  const v = w && typeof w === 'object' ? w : {};
  return {
    type: v.type === 'image' && v.image ? 'image' : 'text',
    text: String(v.text || fallbackText).slice(0, 60),
    image: typeof v.image === 'string' && v.image.startsWith('/m/a/') ? v.image : null,
    opacity: Math.min(1, Math.max(0.05, Number(v.opacity) || 0.35)),
    layout: LAYOUTS.includes(v.layout) ? v.layout : 'tiled',
  };
}

const cache = new Map(); // eventId -> { at, wm }
export const clearWatermarkCache = () => cache.clear();

export async function watermarkForEvent(eventId) {
  const hit = cache.get(eventId);
  if (hit && Date.now() - hit.at < 10_000) return hit.wm;
  const ev = await db.one(
    `select e.watermark_mode, ph.watermark from events e left join photographers ph on ph.user_id = e.photographer_id where e.id = $1`,
    [eventId],
  );
  let wm = null;
  if (ev && ev.watermark_mode !== 'none') {
    const site = await getSetting('watermark', null);
    wm = normalizeWatermark(ev.watermark_mode === 'photographer' && ev.watermark ? ev.watermark : site);
  }
  cache.set(eventId, { at: Date.now(), wm });
  return wm;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

function textSvg(w, h, wm) {
  const t = escapeXml(wm.text);
  const op = wm.opacity;
  const font = 'font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" fill="#fff"';
  const stroke = `stroke="#000" stroke-opacity="${(op * 0.4).toFixed(2)}"`;
  let body;
  if (wm.layout === 'tiled') {
    const size = Math.max(14, Math.round(Math.min(w, h) / 16));
    const gapX = Math.round(size * Math.max(6, t.length * 0.75));
    const gapY = size * 5;
    body = `<defs><pattern id="wm" width="${gapX}" height="${gapY}" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
      <text x="0" y="${size}" ${font} font-size="${size}" fill-opacity="${op}" ${stroke} stroke-width="1">${t}</text></pattern></defs>
      <rect width="100%" height="100%" fill="url(#wm)"/>`;
  } else if (wm.layout === 'center') {
    const size = Math.round(Math.min(w / Math.max(4, t.length * 0.62), h / 5));
    body = `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" ${font} font-size="${size}" fill-opacity="${op}" ${stroke} stroke-width="2">${t}</text>`;
  } else {
    const size = Math.max(14, Math.round(Math.min(w, h) / 15));
    const m = Math.round(size * 0.8);
    body = `<text x="${w - m}" y="${h - m}" text-anchor="end" ${font} font-size="${size}" fill-opacity="${Math.min(1, op + 0.35)}" stroke="#000" stroke-opacity="0.45" stroke-width="${Math.max(1, Math.round(size / 18))}" paint-order="stroke">${t}</text>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
}

// Multiplica a transparencia do logo pela opacidade escolhida.
async function fadedLogo(file, width, opacity, rotate = 0) {
  let img = sharp(file).ensureAlpha().resize({ width: Math.max(16, Math.round(width)) });
  const faded = await img
    .composite([{ input: Buffer.from([255, 255, 255, Math.round(255 * opacity)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return rotate ? sharp(faded).rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() : faded;
}

// Lista de camadas para o sharp.composite() numa imagem w x h.
export async function watermarkLayers(wm, w, h) {
  if (!wm) return [];
  if (wm.type === 'image' && wm.image) {
    const file = path.join(dirs.public, wm.image.replace(/^\/m\//, ''));
    try {
      if (wm.layout === 'tiled') {
        const logo = await fadedLogo(file, w * 0.2, wm.opacity, -28);
        const meta = await sharp(logo).metadata();
        const padX = Math.round(meta.width * 0.6);
        const padY = Math.round(meta.height * 0.9);
        const tile = await sharp(logo).extend({ right: padX, bottom: padY, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        return [{ input: tile, tile: true, top: 0, left: 0 }];
      }
      if (wm.layout === 'center') {
        return [{ input: await fadedLogo(file, Math.min(w * 0.45, h * 0.9), wm.opacity), gravity: 'centre' }];
      }
      const logo = await fadedLogo(file, w * 0.18, Math.min(1, wm.opacity + 0.25));
      const m = Math.round(Math.min(w, h) * 0.03);
      const padded = await sharp(logo).extend({ right: m, bottom: m, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      return [{ input: padded, gravity: 'southeast' }];
    } catch (err) {
      console.warn('[marca dagua] logo indisponivel, usando texto:', err.message);
    }
  }
  return [{ input: textSvg(w, h, wm), top: 0, left: 0 }];
}

// Previa da marca d'agua sobre uma imagem de exemplo (ou uma foto do proprio evento).
export async function watermarkPreview(wm, samplePath) {
  const base = samplePath
    ? await sharp(samplePath).rotate().resize(1000, 700, { fit: 'inside' }).toBuffer()
    : await sharp({
      create: { width: 1000, height: 667, channels: 3, background: { r: 120, g: 110, b: 100 } },
    })
      .composite([{
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="667"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2622"/><stop offset=".5" stop-color="#c9b8a2"/><stop offset="1" stop-color="#f4efe8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`),
      }])
      .png()
      .toBuffer();
  const meta = await sharp(base).metadata();
  return sharp(base).composite(await watermarkLayers(wm, meta.width, meta.height)).webp({ quality: 80 }).toBuffer();
}
