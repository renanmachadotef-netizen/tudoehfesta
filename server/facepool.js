import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

// Reconhecimento facial no servidor em varias threads (ver face-worker.mjs). Cada foto leva alguns segundos
// de CPU e cada thread usa ~600 MB (buffalo_l); com N threads, N fotos sao analisadas ao mesmo tempo.
// FACE_THREADS fixa o numero; sem ele: metade dos nucleos (o resto fica para o site e a importacao),
// cabendo na memoria (deixa 1,5 GB para o resto), ate 4.
const here = path.dirname(fileURLToPath(import.meta.url));
const memory = process.constrainedMemory?.() || os.totalmem();
const byMemory = Math.floor((memory - 1.5 * 2 ** 30) / (600 * 2 ** 20));
export const FACE_THREADS = Math.max(1, Math.min(8, Number(process.env.FACE_THREADS) || Math.min(4, Math.floor(os.cpus().length / 2), byMemory)));
const workers = [];
const queue = [];
let seq = 0;

function spawn() {
  const w = new Worker(path.join(here, 'face-worker.mjs'));
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

function send(w, job) {
  w.jobs.set(job.id, job);
  w.postMessage({ id: job.id, file: job.file, opts: job.opts, kps: job.kps });
}

function next() {
  while (queue.length) {
    let w = workers.find((x) => x.jobs.size === 0);
    if (!w && workers.length < FACE_THREADS) w = spawn();
    if (!w) return;
    send(w, queue.shift());
  }
}

// Selfie (cliente esperando): vai direto para a thread menos ocupada, mesmo que ela esteja no meio de uma foto
// do reprocessamento. As duas dividem a CPU; a selfie nao fica na fila atras das fotos.
function run(job, urgent) {
  return new Promise((resolve, reject) => {
    Object.assign(job, { id: ++seq, resolve, reject });
    if (!urgent) {
      queue.push(job);
      return next();
    }
    const idle = workers.find((x) => x.jobs.size === 0);
    send(idle || (workers.length < FACE_THREADS ? spawn() : workers.reduce((a, b) => (b.jobs.size < a.jobs.size ? b : a))), job);
  });
}

// -> [{ d: number[DIM], yaw, roll, ratio, kps, box: {x,y,w,h} (fracoes), score }]
// opts.urgent: cliente esperando; opts.maxSide / opts.embed: ver analyze em face-engine.mjs
export function detectFacesOnServer(file, { urgent = false, ...opts } = {}) {
  return run({ file, opts }, urgent);
}

// Codigo do rosto nos pontos ja achados (kps em fracoes da imagem), sem detectar de novo. Sempre urgente.
export function embedFaceOnServer(file, kps) {
  return run({ file, kps }, true);
}
