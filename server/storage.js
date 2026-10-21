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
//   private/<foto>/<cliente>-<key>-p|t.webp  versao da foto sem o borrao do proprio cliente (so ele ve, via /api/my/view)
// <key> e aleatorio e muda a cada renderizacao: troca o cache do navegador e impede adivinhar enderecos.

export const dirs = {
  originals: path.join(config.dataDir, 'originals'),
  public: path.join(config.dataDir, 'public'),
  tmp: path.join(config.dataDir, 'tmp'),
  private: path.join(config.dataDir, 'private'),
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
// Esconde rostos com mosaico (pixelado) em formato oval. Cerca de 8 blocos na largura do rosto: nao da para
// reconhecer a pessoa e o resto da foto continua natural.
const MOSAIC_CELLS = 8;
export async function blurFaces(buf, width, height, boxes) {
  if (!boxes?.length) return buf;
  const layers = [];
  for (const b of boxes) {
    if (!b || !(b.w > 0) || !(b.h > 0)) continue;
    const padX = b.w * 0.4;
    const padY = b.h * 0.55;
    const left = Math.max(0, Math.floor((b.x - padX) * width));
    const top = Math.max(0, Math.floor((b.y - padY) * height));
    const w = Math.min(width - left, Math.ceil((b.w + 2 * padX) * width));
    const h = Math.min(height - top, Math.ceil((b.h + 2 * padY) * height));
    if (w < 4 || h < 4) continue;
    const big = Math.max(w, h);
    const small = await sharp(buf).extract({ left, top, width: w, height: h })
      .resize(Math.max(2, Math.round((MOSAIC_CELLS * w) / big)), Math.max(2, Math.round((MOSAIC_CELLS * h) / big)), { fit: 'fill' })
      .toBuffer();
    const oval = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#fff"/></svg>`);
    const tile = await sharp(small).resize(w, h, { fit: 'fill', kernel: 'nearest' }).ensureAlpha()
      .composite([{ input: oval, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: tile, left, top });
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
export const privateFile = (photoId, userId, key, size) => path.join(dirs.private, String(photoId), `${userId}-${key}-${size === 't' ? 't' : 'p'}.webp`);

// privateFor: [{ userId, boxes }] -> versoes particulares para quem pediu borrao (sem o rosto dele borrado).
export async function renderPhoto({ eventId, photoId, originalPath, oldKey, srcFile, blurBoxes, privateFor = [] }) {
  const wm = await watermarkForEvent(eventId);
  const key = crypto.randomBytes(8).toString('hex');
  const src = srcFile || originalAbsPath(originalPath);
  await renderVariant(src, 1400, 78, wm, path.join(dirs.public, 'p', String(eventId), fileName(photoId, key)), blurBoxes);
  await renderVariant(src, 480, 70, wm, path.join(dirs.public, 't', String(eventId), fileName(photoId, key)), blurBoxes);
  if (oldKey !== key) await removeVariants(eventId, photoId, oldKey);
  await fsp.rm(path.join(dirs.private, String(photoId)), { recursive: true, force: true });
  for (const v of privateFor) {
    await renderVariant(src, 1400, 78, wm, privateFile(photoId, v.userId, key, 'p'), v.boxes);
    await renderVariant(src, 480, 70, wm, privateFile(photoId, v.userId, key, 't'), v.boxes);
  }
  return key;
}

async function removeVariants(eventId, photoId, key) {
  await Promise.all(['p', 't'].map((v) => fsp.unlink(path.join(dirs.public, v, String(eventId), fileName(photoId, key))).catch(() => {})));
}

// Muda vitrine e miniatura de pasta quando a foto passa para outro evento (sem baixar o original de novo).
export async function movePhotoFiles(fromEventId, toEventId, photoId, key) {
  const name = fileName(photoId, key);
  try {
    for (const v of ['p', 't']) {
      const to = path.join(dirs.public, v, String(toEventId), name);
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.rename(path.join(dirs.public, v, String(fromEventId), name), to);
    }
    return true;
  } catch {
    return false;
  }
}

// Pastas de previas de eventos que nao existem mais (juntados a outro evento por uma versao antiga, que refazia
// tudo): as previas ainda validas vao para o evento atual da foto; o resto e lixo e sai. Devolve quantas mudaram.
export async function relocateOrphanPreviews(db) {
  const live = new Set((await db.many('select id from events')).map((r) => String(r.id)));
  const found = (await fsp.readdir(path.join(dirs.public, 'p')).catch(() => [])).filter((d) => /^\d+$/.test(d) && !live.has(d));
  let moved = 0;
  for (const d of found) {
    const parsed = (await fsp.readdir(path.join(dirs.public, 'p', d)).catch(() => []))
      .map((f) => f.match(/^(\d+)-([0-9a-f]+)\.webp$/)).filter(Boolean);
    const rows = parsed.length ? await db.many('select id, event_id, key from photos where id = any($1::int[])', [parsed.map((m) => Number(m[1]))]) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const m of parsed) {
      const r = byId.get(Number(m[1]));
      if (!r || r.key !== m[2] || String(r.event_id) === d) continue;
      if (await movePhotoFiles(d, r.event_id, r.id, r.key)) {
        await db.query('update photos set needs_render = false where id = $1', [r.id]);
        moved++;
      }
    }
    await Promise.all(['p', 't'].map((v) => fsp.rm(path.join(dirs.public, v, d), { recursive: true, force: true })));
  }
  return moved;
}

// Faxina: arquivos temporarios esquecidos (download cortado por um reinicio) e previas que nenhuma foto usa
// (foto apagada no meio do processamento, previa refeita por outra copia do servidor). Arquivos recentes ficam:
// podem estar sendo gerados agora.
export async function sweepOrphans(db) {
  const out = { tmp: 0, previews: 0, bytes: 0 };
  const now = Date.now();
  const drop = async (file, minAgeMs) => {
    const st = await fsp.stat(file).catch(() => null);
    if (!st || !st.isFile() || now - st.mtimeMs < minAgeMs) return false;
    await fsp.unlink(file).catch(() => {});
    out.bytes += st.size;
    return true;
  };
  for (const f of await fsp.readdir(dirs.tmp).catch(() => [])) if (await drop(path.join(dirs.tmp, f), 60 * 60_000)) out.tmp++;
  const live = new Set((await db.many('select id from events')).map((r) => String(r.id)));
  for (const v of ['p', 't']) {
    for (const d of await fsp.readdir(path.join(dirs.public, v)).catch(() => [])) {
      if (!/^\d+$/.test(d) || !live.has(d)) continue;
      const files = await fsp.readdir(path.join(dirs.public, v, d)).catch(() => []);
      if (!files.length) continue;
      const valid = new Set((await db.many('select id, key from photos where event_id = $1 and key is not null', [Number(d)])).map((r) => fileName(r.id, r.key)));
      for (const f of files) if (!valid.has(f) && (await drop(path.join(dirs.public, v, d, f), 15 * 60_000))) out.previews++;
    }
  }
  return out;
}

export async function removePhotoFiles(eventId, photoId, originalPath, key) {
  await removeVariants(eventId, photoId, key);
  await fsp.rm(path.join(dirs.private, String(photoId)), { recursive: true, force: true });
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
