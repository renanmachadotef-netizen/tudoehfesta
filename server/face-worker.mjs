// Thread separada para o reconhecimento facial no servidor (YuNet + SFace, ver face-engine.mjs). Varias threads
// rodam em paralelo (ver facepool.js); o site continua respondendo durante importacoes grandes.
import { parentPort } from 'node:worker_threads';
import { analyze } from './face-engine.mjs';

parentPort.on('message', async ({ id, file }) => {
  try {
    parentPort.postMessage({ id, faces: await analyze(file) });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
