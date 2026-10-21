import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

// Reconhecimento facial no servidor numa thread separada (ver face-worker.cjs).
const here = path.dirname(fileURLToPath(import.meta.url));
let worker = null;
let seq = 0;
const pending = new Map();

function faceWorker() {
  if (!worker) {
    worker = new Worker(path.join(here, 'face-worker.cjs'));
    worker.on('message', ({ id, faces, error }) => {
      const p = pending.get(id);
      pending.delete(id);
      if (p) error ? p.reject(new Error(error)) : p.resolve(faces);
    });
    worker.on('error', (err) => {
      console.error('[rostos] thread caiu:', err.message);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = null;
    });
  }
  return worker;
}

export function detectFacesOnServer(file) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    faceWorker().postMessage({ id, file });
  });
}
