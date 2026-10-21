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
