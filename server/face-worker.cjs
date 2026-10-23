// Thread separada para o reconhecimento facial no servidor (Human: BlazeFace + FaceMesh + FaceRes, TensorFlow.js
// com WebAssembly). Varias threads rodam em paralelo (ver facepool.js); o site continua respondendo.
//
// Fotos de festa tem muito rosto pequeno (formatura, palco, pista). O detector olha a imagem reduzida, entao
// rosto pequeno some: alem da foto inteira, a foto e examinada em 3 x 3 pedacos sobrepostos (cada rosto fica
// ~3x maior para o detector). Os pedacos so rodam quando a foto pede (rosto pequeno, grupo ou nenhum rosto).
const { parentPort } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const sharp = require('sharp');

const HUMAN_DIR = path.join(path.dirname(require.resolve('@vladmandic/human')), '..');
const WASM_DIR = path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist');
// O pacote declara os caminhos internos sem "./" (o Node recusa o require pelo nome): carrega pelo arquivo.
const { Human } = require(path.join(HUMAN_DIR, 'dist', 'human.node-wasm.js'));

const WHOLE = 1400; // foto inteira (mesmo tamanho da selfie no navegador)
const TILED = 1920; // pedacos saem de uma versao maior da foto
const GRID = 3;
const OVERLAP = 0.25;
const MAX_FACES = 80;

let ready = null;
let human = null;
function init() {
  if (!ready) {
    ready = (async () => {
      // A versao node-wasm busca os modelos por http: serve a pasta de modelos so para esta thread.
      const srv = http.createServer((req, res) => {
        const file = path.join(HUMAN_DIR, 'models', path.basename(req.url.split('?')[0]));
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
      }).listen(0, '127.0.0.1');
      await new Promise((r) => srv.once('listening', r));
      srv.unref();
      human = new Human({
        backend: 'wasm', wasmPath: WASM_DIR + path.sep, modelBasePath: `http://127.0.0.1:${srv.address().port}/`,
        debug: false, async: true, cacheSensitivity: 0,
        filter: { enabled: false }, gesture: { enabled: false }, body: { enabled: false }, hand: { enabled: false },
        object: { enabled: false }, segmentation: { enabled: false },
        face: {
          enabled: true,
          detector: { rotation: true, maxDetected: MAX_FACES, minConfidence: 0.3, minSize: 12, skipFrames: 0, skipTime: 0, return: false },
          mesh: { enabled: true }, attention: { enabled: false }, iris: { enabled: false }, emotion: { enabled: false },
          description: { enabled: true, skipFrames: 0, skipTime: 0 }, antispoof: { enabled: false }, liveness: { enabled: false },
        },
      });
      await human.load();
    })();
  }
  return ready;
}

async function detectRaw({ data, w, h }) {
  const t = human.tf.tensor3d(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), [h, w, 3], 'int32');
  try {
    const res = await human.detect(t);
    return res.face.filter((f) => f.embedding?.length).map((f) => ({ x: f.box[0], y: f.box[1], w: f.box[2], h: f.box[3], score: f.boxScore ?? f.score ?? 0, d: Array.from(f.embedding) }));
  } finally {
    human.tf.dispose(t);
  }
}

async function load(file, maxSide, region) {
  let img = sharp(file).rotate().resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true });
  if (region) img = sharp(await img.toBuffer()).extract(region);
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
};

async function detect(file) {
  await init();
  const whole = await load(file, WHOLE);
  const faces = (await detectRaw(whole)).map((f) => ({ ...f, x: f.x / whole.w, y: f.y / whole.h, w: f.w / whole.w, h: f.h / whole.h }));
  // Foto com poucos rostos grandes (retrato, casal) nao precisa dos pedacos.
  const needTiles = !faces.length || faces.length >= 4 || faces.some((f) => f.w < 0.07);
  if (needTiles) {
    const meta = await sharp(file).rotate().metadata();
    const portrait = (meta.orientation || 1) >= 5;
    const ow = portrait ? meta.height : meta.width, oh = portrait ? meta.width : meta.height;
    const s = Math.min(1, TILED / Math.max(ow, oh));
    const W = Math.round(ow * s), H = Math.round(oh * s);
    const tw = Math.ceil(W / (GRID - (GRID - 1) * OVERLAP)), th = Math.ceil(H / (GRID - (GRID - 1) * OVERLAP));
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const left = Math.max(0, Math.min(W - tw, Math.round(c * tw * (1 - OVERLAP)))), top = Math.max(0, Math.min(H - th, Math.round(r * th * (1 - OVERLAP))));
      const tile = await load(file, TILED, { left, top, width: Math.min(tw, W - left), height: Math.min(th, H - top) });
      for (const f of await detectRaw(tile)) {
        // rosto cortado na borda do pedaco fica para o pedaco vizinho (ou para a foto inteira)
        const e = 2;
        if ((f.x < e && left > 0) || (f.y < e && top > 0) || (f.x + f.w > tile.w - e && left + tile.w < W) || (f.y + f.h > tile.h - e && top + tile.h < H)) continue;
        faces.push({ ...f, x: (f.x + left) / W, y: (f.y + top) / H, w: f.w / W, h: f.h / H });
      }
    }
  }
  // Junta repetidos (o mesmo rosto achado na foto inteira e num pedaco): fica o de maior confianca.
  const keep = [];
  for (const f of faces.sort((a, b) => b.score - a.score)) if (!keep.some((k) => iou(k, f) > 0.3)) keep.push(f);
  return keep.slice(0, MAX_FACES).map((f) => ({
    d: f.d,
    box: { x: +f.x.toFixed(4), y: +f.y.toFixed(4), w: +f.w.toFixed(4), h: +f.h.toFixed(4) },
    score: +Number(f.score).toFixed(3),
  }));
}

parentPort.on('message', async ({ id, file }) => {
  try {
    parentPort.postMessage({ id, faces: await detect(file) });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
