// Thread separada para o reconhecimento facial no servidor (ver face-engine.mjs). Varias threads rodam em
// paralelo (ver facepool.js); o site continua respondendo durante importacoes grandes. Uma thread pode rodar
// mais de um trabalho ao mesmo tempo (a selfie de um cliente nao espera a foto do reprocessamento acabar).
import { parentPort } from 'node:worker_threads';
import { analyze, embedAt } from './face-engine.mjs';

parentPort.on('message', async ({ id, file, opts, kps }) => {
  try {
    parentPort.postMessage({ id, faces: kps ? await embedAt(file, kps) : await analyze(file, opts) });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
