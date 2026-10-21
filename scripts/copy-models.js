// Copia so os modelos usados (deteccao SSD, pontos do rosto e reconhecimento) para web/public/models.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('node_modules/@vladmandic/face-api/model');
const dest = path.resolve('web/public/models');
fs.mkdirSync(dest, { recursive: true });
for (const base of ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model']) {
  for (const ext of ['.bin', '-weights_manifest.json']) {
    fs.copyFileSync(path.join(src, base + ext), path.join(dest, base + ext));
  }
}
console.log('[modelos] copiados para', dest);
