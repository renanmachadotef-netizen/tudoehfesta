import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import { config } from './config.js';

// Leitura de numero de peito (corridas, caminhadas, torneios). O numero quase sempre fica no peito, logo abaixo
// do rosto: le primeiro essas regioes (a partir das caixas de rosto ja detectadas), ampliadas e em tons de cinza,
// e depois a foto inteira. So digitos; numeros de 2 a 6 algarismos.
let worker = null;
async function getWorker() {
  if (!worker) {
    const cachePath = path.join(config.dataDir, 'ocr');
    fs.mkdirSync(cachePath, { recursive: true });
    worker = await createWorker('eng', 1, { cachePath, logger: () => {}, errorHandler: () => {} });
    await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  }
  return worker;
}

// So leituras confiaveis: palavra inteira de 2 a 6 digitos com confianca alta (texturas viram numeros curtos).
const MIN_CONF = 75;
async function ocr(buf) {
  const w = await getWorker();
  const { data } = await w.recognize(buf, {}, { text: true, blocks: true });
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    for (const word of l.words || []) {
      const t = String(word.text || '').trim();
      if (process.env.BIB_DEBUG) console.log('[bib]', t, Math.round(word.confidence));
      if (/^\d{2,6}$/.test(t) && word.confidence >= MIN_CONF) out.push(t);
    }
  }
  return out;
}

// boxes: caixas de rosto normalizadas (0-1) na orientacao correta.
export async function readBibs(file, boxes = []) {
  const img = sharp(file).rotate();
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const found = new Map();
  const add = (list, weight) => list.forEach((n) => found.set(n, (found.get(n) || 0) + weight));

  for (const b of boxes.slice(0, 12)) {
    if (!b || !(b.w > 0)) continue;
    const left = Math.max(0, Math.round((b.x - b.w * 1.3) * W));
    const top = Math.max(0, Math.round((b.y + b.h * 1.05) * H));
    const width = Math.min(W - left, Math.round(b.w * 3.6 * W));
    const height = Math.min(H - top, Math.round(b.h * 3.4 * H));
    if (width < 40 || height < 40) continue;
    const crop = await sharp(data).extract({ left, top, width, height })
      .resize({ height: 700, withoutEnlargement: false }).grayscale().normalize().sharpen().png().toBuffer();
    add(await ocr(crop), 2);
  }
  // Foto inteira (atleta sem rosto detectado, de costas para o lado, etc.)
  const full = await sharp(data).resize({ width: 2200, withoutEnlargement: false }).grayscale().normalize().png().toBuffer();
  add(await ocr(full), 1);
  return [...found.keys()].slice(0, 12);
}
