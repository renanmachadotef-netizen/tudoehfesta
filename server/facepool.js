import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

// Reconhecimento facial no servidor em varias threads (ver face-worker.cjs). Cada foto leva alguns segundos
// de CPU e cada thread usa ~450 MB; com N threads, N fotos sao analisadas ao mesmo tempo.
// FACE_THREADS fixa o numero; sem ele: metade dos nucleos (o resto fica para o site e a importacao),
// cabendo na memoria (deixa 1,5 GB para o resto), ate 4.
const here = path.dirname(fileURLToPath(import.meta.url));
const memory = process.constrainedMemory?.() || os.totalmem();
const byMemory = Math.floor((memory - 1.5 * 2 ** 30) / (450 * 2 ** 20));
export const FACE_THREADS = Math.max(1, Math.min(8, Number(process.env.FACE_THREADS) || Math.min(4, Math.floor(os.cpus().length / 2), byMemory)));
const workers = [];
const queue = [];
let seq = 0;

function spawn() {
  const w = new Worker(path.join(here, 'face-worker.cjs'));
  w.jobs = new Map();
  w.on('message', ({ id, faces, error }) => {
    const job = w.jobs.get(id);
    w.jobs.delete(id);
    if (job) error ? job.reject(new Error(error)) : job.resolve(faces);
    next();
  });
  w.on('error', (err) => {
    console.error('[rostos] thread caiu:', err.message);
    for (const job of w.jobs.values()) job.reject(err);
    workers.splice(workers.indexOf(w), 1);
    next();
  });
  workers.push(w);
  return w;
}

function next() {
  while (queue.length) {
    let w = workers.find((x) => x.jobs.size === 0);
    if (!w && workers.length < FACE_THREADS) w = spawn();
    if (!w) return;
    const job = queue.shift();
    w.jobs.set(job.id, job);
    w.postMessage({ id: job.id, file: job.file });
  }
}

// -> [{ d: number[1024], box: {x,y,w,h} (fracoes), score }]
export function detectFacesOnServer(file) {
  return new Promise((resolve, reject) => {
    queue.push({ id: ++seq, file, resolve, reject });
    next();
  });
}
