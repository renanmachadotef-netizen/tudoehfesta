import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from './config.js';

// Pastas dentro de DATA_DIR (volume do Easypanel):
//   originals/<evento>/<arquivo>   alta resolucao, nunca servida direto (so via /api/download)
//   public/p/<evento>/<foto>.webp  vitrine 1400px com marca d'agua
//   public/t/<evento>/<foto>.webp  miniatura 480px com marca d'agua
//   public/a/...                   avatares, capas, logo do site
//   tmp/                           uploads em andamento

export const dirs = {
  originals: path.join(config.dataDir, 'originals'),
  public: path.join(config.dataDir, 'public'),
  tmp: path.join(config.dataDir, 'tmp'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

sharp.cache({ memory: 128 });
sharp.concurrency(2);

export const previewUrl = (eventId, photoId) => `/m/p/${eventId}/${photoId}.webp`;
export const thumbUrl = (eventId, photoId) => `/m/t/${eventId}/${photoId}.webp`;

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

// Marca d'agua em diagonal repetida: dificulta recorte e print sem esconder a foto.
function watermarkSvg(w, h, label) {
  const size = Math.max(14, Math.round(Math.min(w, h) / 16));
  const gapX = size * 11;
  const gapY = size * 5;
  const text = escapeXml(label);
  const center = Math.round(Math.min(w, h) / 9);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <pattern id="wm" width="${gapX}" height="${gapY}" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
      <text x="0" y="${size}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" font-weight="700"
        fill="#fff" fill-opacity="0.30" stroke="#000" stroke-opacity="0.12" stroke-width="1">${text}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#wm)"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Sans, Arial, sans-serif"
    font-size="${center}" font-weight="800" fill="#fff" fill-opacity="0.42" stroke="#000" stroke-opacity="0.18"
    stroke-width="2">${text}</text>
</svg>`);
}

async function renderVariant(input, maxSide, quality, label, outFile) {
  const resized = await sharp(input)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = resized.info;
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await sharp(resized.data)
    .composite([{ input: watermarkSvg(width, height, label), top: 0, left: 0 }])
    .webp({ quality, effort: 4 })
    .toFile(outFile);
  return { width, height };
}

// Recebe o arquivo temporario do upload, guarda o original e gera vitrine + miniatura.
export async function storePhoto({ tmpPath, eventId, photoId, originalName, label }) {
  const buf = await fsp.readFile(tmpPath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const meta = await sharp(buf).metadata();
  const ext = (path.extname(originalName || '').toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
  const rel = path.posix.join(String(eventId), `${photoId}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  const abs = path.join(dirs.originals, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.rename(tmpPath, abs).catch(async () => {
    await fsp.copyFile(tmpPath, abs);
    await fsp.unlink(tmpPath).catch(() => {});
  });
  const rotated = meta.orientation && meta.orientation >= 5;
  await renderVariant(buf, 1400, 78, label, path.join(dirs.public, 'p', String(eventId), `${photoId}.webp`));
  await renderVariant(buf, 480, 70, label, path.join(dirs.public, 't', String(eventId), `${photoId}.webp`));
  return {
    originalPath: rel,
    sha256,
    bytes: buf.length,
    width: rotated ? meta.height : meta.width,
    height: rotated ? meta.width : meta.height,
  };
}

export async function photoSha(tmpPath) {
  const buf = await fsp.readFile(tmpPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function removePhotoFiles(eventId, photoId, originalPath) {
  const files = [
    path.join(dirs.public, 'p', String(eventId), `${photoId}.webp`),
    path.join(dirs.public, 't', String(eventId), `${photoId}.webp`),
  ];
  if (originalPath) files.push(path.join(dirs.originals, originalPath));
  await Promise.all(files.map((f) => fsp.unlink(f).catch(() => {})));
}

export function originalAbsPath(rel) {
  const abs = path.resolve(dirs.originals, rel);
  if (!abs.startsWith(path.resolve(dirs.originals))) throw new Error('caminho invalido');
  return abs;
}

// Imagens soltas (avatar, logo): quadradas ou limitadas, sem marca d'agua.
export async function storeAsset(tmpPath, folder, { square = false, maxSide = 800 } = {}) {
  const name = `${crypto.randomBytes(8).toString('hex')}.webp`;
  const out = path.join(dirs.public, 'a', folder, name);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  let img = sharp(tmpPath).rotate();
  img = square ? img.resize(maxSide, maxSide, { fit: 'cover' }) : img.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  await img.webp({ quality: 82 }).toFile(out);
  await fsp.unlink(tmpPath).catch(() => {});
  return `/m/a/${folder}/${name}`;
}
