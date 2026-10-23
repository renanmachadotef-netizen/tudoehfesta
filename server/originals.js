import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { dirs, originalAbsPath } from './storage.js';
import { downloadDriveFile } from './drive.js';

// Onde esta o original de uma foto:
//   'evento/arquivo.jpg'  -> no volume do servidor (DATA_DIR/originals)
//   'drive:<id do arquivo>' -> so no Google Drive (economiza disco). Ao vender, a foto e copiada para o
//                              servidor (photos.needs_copy) para o cliente nao depender do Drive.

export const isDriveOriginal = (p) => String(p || '').startsWith('drive:');
export const driveIdOf = (p) => String(p).slice(6);

// Copia do original baixado do Drive guardada ate o reconhecimento facial ler a foto (a foto ja foi liberada
// com a previa; assim os rostos nao precisam baixar de novo). Com muitas fotos esperando, nao guarda mais:
// a fila baixa do Drive quando chegar a vez delas.
const FACE_CACHE_MAX = Math.max(0, Number(process.env.FACE_CACHE_MAX ?? 800)); // arquivos (~8 MB cada)
const faceCacheFile = (photoId) => path.join(dirs.facecache, String(photoId));
export async function keepForFaces(photoId, file) {
  const n = (await fsp.readdir(dirs.facecache).catch(() => [])).length;
  if (n >= FACE_CACHE_MAX) return false;
  await fsp.rename(file, faceCacheFile(photoId)).catch(() => fsp.copyFile(file, faceCacheFile(photoId)));
  return true;
}
// fn(caminhoLocal) para o reconhecimento facial: usa a copia guardada (e apaga depois) ou o original.
export async function withFaceSource(photo, fn) {
  const cached = faceCacheFile(photo.id);
  if (fs.existsSync(cached)) {
    try { return await fn(cached); } finally { await fsp.unlink(cached).catch(() => {}); }
  }
  return withOriginal(photo.original_path, fn);
}
// Faxina: copias de fotos que ja tem rostos (ou foram apagadas) e copias esquecidas ha mais de 3 dias.
export async function cleanFaceCache(db) {
  const files = (await fsp.readdir(dirs.facecache).catch(() => [])).filter((f) => /^\d+$/.test(f));
  if (!files.length) return 0;
  const waiting = new Set((await db.many('select id from photos where needs_faces and id = any($1::int[])', [files.map(Number)])).map((r) => String(r.id)));
  let removed = 0;
  for (const f of files) {
    const st = await fsp.stat(faceCacheFile(f)).catch(() => null);
    if (!waiting.has(f) || !st || Date.now() - st.mtimeMs > 3 * 864e5) { await fsp.unlink(faceCacheFile(f)).catch(() => {}); removed++; }
  }
  return removed;
}

// Executa fn(caminhoLocal) com o original disponivel em disco; baixa do Drive se preciso e apaga depois.
export async function withOriginal(originalPath, fn) {
  if (!isDriveOriginal(originalPath)) return fn(originalAbsPath(originalPath));
  const tmp = path.join(dirs.tmp, `orig-${crypto.randomBytes(6).toString('hex')}`);
  try {
    await downloadDriveFile(driveIdOf(originalPath), tmp);
    return await fn(tmp);
  } finally {
    await fsp.unlink(tmp).catch(() => {});
  }
}

// Stream do original para download (servidor ou Drive).
export async function originalStream(originalPath) {
  if (!isDriveOriginal(originalPath)) return fs.createReadStream(originalAbsPath(originalPath));
  const tmp = path.join(dirs.tmp, `dl-${crypto.randomBytes(6).toString('hex')}`);
  await downloadDriveFile(driveIdOf(originalPath), tmp);
  const s = fs.createReadStream(tmp);
  s.on('close', () => fsp.unlink(tmp).catch(() => {}));
  return s;
}

// Copia um original do Drive para o servidor e devolve o novo caminho relativo.
export async function copyToServer(eventId, photoId, originalPath, originalName) {
  const ext = (path.extname(originalName || '').toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
  const rel = path.posix.join(String(eventId), `${photoId}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  const abs = path.join(dirs.originals, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await downloadDriveFile(driveIdOf(originalPath), abs);
  return rel;
}
