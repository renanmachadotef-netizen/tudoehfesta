// Copia so os modelos usados pela selfie (Human: deteccao, pontos do rosto e reconhecimento) e os arquivos
// WebAssembly do TensorFlow (para navegador sem WebGL) para web/public/models.
import fs from 'node:fs';
import path from 'node:path';

const human = path.resolve('node_modules/@vladmandic/human/models');
const wasm = path.resolve('node_modules/@tensorflow/tfjs-backend-wasm/dist');
const dest = path.resolve('web/public/models');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.join(dest, 'wasm'), { recursive: true });
for (const base of ['blazeface', 'facemesh', 'faceres']) {
  for (const ext of ['.json', '.bin']) fs.copyFileSync(path.join(human, base + ext), path.join(dest, base + ext));
}
for (const f of fs.readdirSync(wasm).filter((n) => n.endsWith('.wasm'))) fs.copyFileSync(path.join(wasm, f), path.join(dest, 'wasm', f));
console.log('[modelos] copiados para', dest);
