import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from './config.js';
import { watermarkForEvent, watermarkLayers } from './watermark.js';

// Pastas dentro de DATA_DIR (volume do Easypanel):
//   originals/<evento>/<arquivo>          alta resolucao, nunca servida direto (so via /api/download)
//   public/p/<evento>/<foto>-<key>.webp   vitrine 1400px com marca d'agua
//   public/t/<evento>/<foto>-<key>.webp   miniatura 480px com marca d'agua
//   public/a/...                          avatares, logos, marcas d'agua
//   tmp/                                  uploads e downloads em andamento
// <key> e aleatorio e muda a cada renderizacao: troca o cache do navegador e impede adivinhar enderecos.

export const dirs = {
  originals: path.join(config.dataDir, 'originals'),
  public: path.join(config.dataDir, 'public'),
  tmp: path.join(config.dataDir, 'tmp'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

sharp.cache({ memory: 128 });
sharp.concurrency(2);

const fileName = (photoId, key) => (key ? `${photoId}-${key}.webp` : `${photoId}.webp`);
export const previewUrl = (eventId, photoId, key) => `/m/p/${eventId}/${fileName(photoId, key)}`;
export const thumbUrl = (eventId, photoId, key) => `/m/t/${eventId}/${fileName(photoId, key)}`;

export function originalAbsPath(rel) {
  const abs = path.resolve(dirs.originals, rel);
  if (!abs.startsWith(path.resolve(dirs.originals))) throw new Error('caminho invalido');
  return abs;
}

export async function fileSha(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}
export const photoSha = fileSha;

// Guarda o original (move o arquivo temporario) e devolve os metadados.
export async function saveOriginal({ tmpPath, eventId, photoId, originalName, sha256 }) {
  const meta = await sharp(tmpPath).metadata();
  if (!meta.width || !meta.height) throw new Error('imagem invalida');
  const ext = (path.extname(originalName || '').toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
  const rel = path.posix.join(String(eventId), `${photoId}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  const abs = path.join(dirs.originals, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const { size } = await fsp.stat(tmpPath);
  await fsp.rename(tmpPath, abs).catch(async () => {
    await fsp.copyFile(tmpPath, abs);
    await fsp.unlink(tmpPath).catch(() => {});
  });
  const rotated = meta.orientation && meta.orientation >= 5;
  return {
    originalPath: rel,
    sha256: sha256 || (await fileSha(abs)),
    bytes: size,
    width: rotated ? meta.height : meta.width,
    height: rotated ? meta.width : meta.height,
  };
}

// Borra rostos (caixas normalizadas 0-1, ja na orientacao correta) de quem pediu "borrar minhas imagens".
export async function blurFaces(buf, width, height, boxes) {
  if (!boxes?.length) return buf;
  const layers = [];
  for (const b of boxes) {
    if (!b || !(b.w > 0) || !(b.h > 0)) continue;
    const padX = b.w * 0.35;
    const padY = b.h * 0.45;
    const left = Math.max(0, Math.floor((b.x - padX) * width));
    const top = Math.max(0, Math.floor((b.y - padY) * height));
    const w = Math.min(width - left, Math.ceil((b.w + 2 * padX) * width));
    const h = Math.min(height - top, Math.ceil((b.h + 2 * padY) * height));
    if (w < 4 || h < 4) continue;
    const sigma = Math.max(10, Math.round(Math.max(w, h) / 5));
    layers.push({ input: await sharp(buf).extract({ left, top, width: w, height: h }).blur(sigma).toBuffer(), left, top });
  }
  return layers.length ? sharp(buf).composite(layers).toBuffer() : buf;
}

// Original em alta com rostos borrados (para quem compra uma foto em que outra pessoa pediu para ser borrada).
export async function blurredOriginal(file, boxes) {
  const { data, info } = await sharp(file).rotate().toBuffer({ resolveWithObject: true });
  const out = await blurFaces(data, info.width, info.height, boxes);
  return sharp(out).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}

async function renderVariant(input, maxSide, quality, wm, outFile, blurBoxes) {
  const resized = await sharp(input)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  const base = await blurFaces(resized.data, resized.info.width, resized.info.height, blurBoxes);
  await sharp(base)
    .composite(await watermarkLayers(wm, resized.info.width, resized.info.height))
    .webp({ quality, effort: 4 })
    .toFile(outFile);
}

// Gera vitrine e miniatura a partir do original com a marca d'agua atual do evento. Devolve a nova key.
export async function renderPhoto({ eventId, photoId, originalPath, oldKey, srcFile, blurBoxes }) {
  const wm = await watermarkForEvent(eventId);
  const key = crypto.randomBytes(8).toString('hex');
  const src = srcFile || originalAbsPath(originalPath);
  await renderVariant(src, 1400, 78, wm, path.join(dirs.public, 'p', String(eventId), fileName(photoId, key)), blurBoxes);
  await renderVariant(src, 480, 70, wm, path.join(dirs.public, 't', String(eventId), fileName(photoId, key)), blurBoxes);
  if (oldKey !== key) await removeVariants(eventId, photoId, oldKey);
  return key;
}

async function removeVariants(eventId, photoId, key) {
  await Promise.all(['p', 't'].map((v) => fsp.unlink(path.join(dirs.public, v, String(eventId), fileName(photoId, key))).catch(() => {})));
}

export async function removePhotoFiles(eventId, photoId, originalPath, key) {
  await removeVariants(eventId, photoId, key);
  if (originalPath && !originalPath.startsWith('drive:')) await fsp.unlink(path.join(dirs.originals, originalPath)).catch(() => {});
}

// Imagens soltas (avatar, logo, marca d'agua): sem marca d'agua, mantendo transparencia.
export async function storeAsset(tmpPath, folder, { square = false, maxSide = 800, png = false } = {}) {
  const name = `${crypto.randomBytes(8).toString('hex')}.${png ? 'png' : 'webp'}`;
  const out = path.join(dirs.public, 'a', folder, name);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  let img = sharp(tmpPath).rotate();
  img = square ? img.resize(maxSide, maxSide, { fit: 'cover' }) : img.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  await (png ? img.png() : img.webp({ quality: 82 })).toFile(out);
  await fsp.unlink(tmpPath).catch(() => {});
  return `/m/a/${folder}/${name}`;
}
