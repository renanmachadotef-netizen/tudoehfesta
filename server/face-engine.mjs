// Reconhecimento facial com ONNX Runtime (nativo). Dois modelos (ver face-model.js):
//   - buffalo_l (InsightFace): SCRFD 10G acha os rostos e da 5 pontos; ArcFace ResNet-50 gera 512 numeros;
//   - sface (OpenCV): YuNet acha os rostos; SFace gera 128 numeros.
// Em ambos, cada rosto e alinhado pelos 5 pontos (olhos, nariz, cantos da boca) num quadrado padrao de 112 x 112,
// a partir da foto em alta resolucao. Selfie e fotos do acervo passam pelo mesmo codigo, entao sao comparaveis.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { FACE_MODEL } from './face-model.js';

const MODELS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'models');
const BUFFALO = FACE_MODEL === 'buffalo_l';
const SRC_SIDE = 4096; // pontos do rosto e codigo saem da foto em alta resolucao
const MAX_FACES = 80;
// Deteccao: o SCRFD e mais pesado, roda numa versao menor da foto (ainda acha rostos de ~14 px nela, ~20 px
// numa foto de 1920); a YuNet roda em 1920.
const MAX_SIDE = BUFFALO ? 1280 : 1920;
const MIN_FACE = BUFFALO ? 14 : 20; // px na imagem analisada; menor que isso o codigo nao e confiavel
const MIN_SCORE = BUFFALO ? 0.5 : 0.75;
const REFINE_FACE = BUFFALO ? 128 : 192; // 2a passada: rosto ampliado para ~N px (pontos mais precisos)
const REFINE_BELOW = BUFFALO ? 64 : Infinity; // so rostos menores que isso na deteccao passam pela 2a passada
const STRIDES = [8, 16, 32];
// posicao padrao dos 5 pontos no rosto alinhado de 112 x 112 (a mesma no ArcFace e no SFace)
const TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

// Uma thread do ONNX por sessao: o paralelismo vem das threads do facepool.
const OPTS = { intraOpNumThreads: 1, interOpNumThreads: 1, graphOptimizationLevel: 'extended', logSeverityLevel: 3 };
let sessions = null;
export function load() {
  if (!sessions) {
    const files = BUFFALO
      ? ['buffalo_l/det_10g.onnx', 'buffalo_l/w600k_r50.onnx']
      : ['face_detection_yunet_2026may.onnx', 'face_recognition_sface_2021dec.onnx'];
    const missing = files.find((f) => !fs.existsSync(path.join(MODELS, f)));
    // buffalo_l nao vem no repositorio (288 MB): o Dockerfile baixa do InsightFace
    if (missing) throw new Error(`Modelo de rosto não encontrado: server/models/${missing} (veja o Dockerfile)`);
    sessions = Promise.all(files.map((f) => ort.InferenceSession.create(path.join(MODELS, f), OPTS))).then(([det, rec]) => ({ det, rec }));
  }
  return sessions;
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
};
// rostos repetidos (varias celulas no mesmo rosto): fica o de maior confianca
function nms(faces, minFace, thr) {
  const keep = [];
  for (const f of faces.sort((a, b) => b.score - a.score)) if (!keep.some((k) => iou(k, f) > thr)) keep.push(f);
  return keep.filter((f) => f.w >= minFace).slice(0, MAX_FACES);
}

// YuNet: imagem RGB (Uint8, w x h) -> rostos [{ x, y, w, h, score, kps }] em pixels da imagem.
async function detectYunet(det, rgb, w, h, minScore, minFace) {
  const pw = Math.ceil(w / 32) * 32, ph = Math.ceil(h / 32) * 32;
  const plane = pw * ph;
  const input = new Float32Array(3 * plane); // BGR, 0-255, com borda preta ate multiplo de 32
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3, d = y * pw + x;
      input[d] = rgb[s + 2]; input[plane + d] = rgb[s + 1]; input[2 * plane + d] = rgb[s];
    }
  }
  const out = await det.run({ input: new ort.Tensor('float32', input, [1, 3, ph, pw]) });
  const faces = [];
  for (const st of STRIDES) {
    const cols = pw / st, rows = ph / st;
    const cls = out[`cls_${st}`].data, obj = out[`obj_${st}`].data, bbox = out[`bbox_${st}`].data, kps = out[`kps_${st}`].data;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const score = Math.sqrt(Math.min(Math.max(cls[i], 0), 1) * Math.min(Math.max(obj[i], 0), 1));
        if (score < minScore) continue;
        const cx = (c + bbox[i * 4]) * st, cy = (r + bbox[i * 4 + 1]) * st;
        const bw = Math.exp(bbox[i * 4 + 2]) * st, bh = Math.exp(bbox[i * 4 + 3]) * st;
        const pts = [];
        for (let n = 0; n < 5; n++) pts.push([(kps[i * 10 + 2 * n] + c) * st, (kps[i * 10 + 2 * n + 1] + r) * st]);
        faces.push({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, score, kps: pts });
      }
    }
  }
  return nms(faces, minFace, 0.3);
}

// SCRFD (InsightFace): RGB normalizado (v - 127.5) / 128, borda ate multiplo de 32. Em cada escala (8, 16, 32)
// ha 2 ancoras por celula; a caixa vem como distancias do centro da celula ate as bordas.
async function detectScrfd(det, rgb, w, h, minScore, minFace) {
  const pw = Math.ceil(w / 32) * 32, ph = Math.ceil(h / 32) * 32;
  const plane = pw * ph;
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3, d = y * pw + x;
      input[d] = (rgb[s] - 127.5) / 128; input[plane + d] = (rgb[s + 1] - 127.5) / 128; input[2 * plane + d] = (rgb[s + 2] - 127.5) / 128;
    }
  }
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, ph, pw]) });
  // saidas: notas (N x 1), caixas (N x 4) e pontos (N x 10) de cada escala; a escala sai do tamanho N
  const byStride = {};
  for (const name of det.outputNames) {
    const t = out[name];
    const n = t.dims[0], kind = t.dims[1];
    const st = STRIDES.find((s) => (pw / s) * (ph / s) * 2 === n);
    (byStride[st] ||= {})[kind] = t.data;
  }
  const faces = [];
  for (const st of STRIDES) {
    const { 1: score, 4: bbox, 10: kps } = byStride[st];
    const cols = pw / st;
    for (let i = 0; i < score.length; i++) {
      if (score[i] < minScore) continue;
      const cell = i >> 1;
      const cx = (cell % cols) * st, cy = Math.floor(cell / cols) * st;
      const x1 = cx - bbox[i * 4] * st, y1 = cy - bbox[i * 4 + 1] * st, x2 = cx + bbox[i * 4 + 2] * st, y2 = cy + bbox[i * 4 + 3] * st;
      const pts = [];
      for (let k = 0; k < 5; k++) pts.push([cx + kps[i * 10 + 2 * k] * st, cy + kps[i * 10 + 2 * k + 1] * st]);
      faces.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, score: score[i], kps: pts });
    }
  }
  return nms(faces, minFace, 0.4);
}

const detect = BUFFALO ? detectScrfd : detectYunet;

// Transformacao de semelhanca (escala, rotacao, deslocamento) que leva os 5 pontos do rosto ao padrao (Umeyama).
function similarity(src, dst) {
  const n = src.length;
  let mx = 0, my = 0, ux = 0, uy = 0;
  for (let i = 0; i < n; i++) { mx += src[i][0]; my += src[i][1]; ux += dst[i][0]; uy += dst[i][1]; }
  mx /= n; my /= n; ux /= n; uy /= n;
  let a = 0, b = 0, v = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - mx, sy = src[i][1] - my, dx = dst[i][0] - ux, dy = dst[i][1] - uy;
    a += sx * dx + sy * dy; b += sx * dy - sy * dx; v += sx * sx + sy * sy;
  }
  const scale = Math.hypot(a, b) / v, th = Math.atan2(b, a);
  const cs = scale * Math.cos(th), sn = scale * Math.sin(th);
  return { cs, sn, tx: ux - (cs * mx - sn * my), ty: uy - (sn * mx + cs * my) };
}

// Recorta o rosto alinhado em 112 x 112 (interpolacao bilinear) -> tensor RGB. SFace: 0-255;
// ArcFace: (v - 127.5) / 127.5.
function alignedTensor(rgb, w, h, kps) {
  const { cs, sn, tx, ty } = similarity(kps, TEMPLATE);
  const det = cs * cs + sn * sn; // inversa: do pixel de saida para o ponto na foto
  const plane = 112 * 112;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 112; x++) {
      const px = x - tx, py = y - ty;
      const sx = (cs * px + sn * py) / det, sy = (-sn * px + cs * py) / det;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const d = y * 112 + x;
      for (let ch = 0; ch < 3; ch++) {
        const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : rgb[(yy * w + xx) * 3 + ch]);
        const val = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
        out[ch * plane + d] = BUFFALO ? (val - 127.5) / 127.5 : val;
      }
    }
  }
  return new ort.Tensor('float32', out, [1, 3, 112, 112]);
}

// Recorte (left, top, lado) da imagem fonte reamostrado para out x out (bilinear).
function crop(rgb, w, h, left, top, side, out) {
  const buf = new Uint8Array(out * out * 3);
  const k = side / out;
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const sx = left + (x + 0.5) * k - 0.5, sy = top + (y + 0.5) * k - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : rgb[(yy * w + xx) * 3 + ch]);
        buf[(y * out + x) * 3 + ch] = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      }
    }
  }
  return buf;
}

// 2a passada: em rosto pequeno os pontos saem imprecisos. Recorta a regiao do rosto da foto em alta
// resolucao, amplia o rosto e detecta de novo so ali; os pontos voltam para a foto fonte.
async function refine(det, src, sw, sh, f) {
  const size = Math.max(f.w, f.h) * 2;
  const out = Math.min(512, Math.max(96, Math.round((size * REFINE_FACE) / Math.max(f.w, f.h) / 32) * 32));
  const left = f.x + f.w / 2 - size / 2, top = f.y + f.h / 2 - size / 2;
  const found = await detect(det, crop(src, sw, sh, left, top, size, out), out, out, 0.5, 12);
  if (!found.length) return f.kps;
  const c = out / 2;
  const best = found.reduce((b, g) => (Math.hypot(g.x + g.w / 2 - c, g.y + g.h / 2 - c) < Math.hypot(b.x + b.w / 2 - c, b.y + b.h / 2 - c) ? g : b));
  const k = size / out;
  return best.kps.map(([x, y]) => [left + x * k, top + y * k]);
}

async function embed(rec, src, sw, sh, kps) {
  const out = await rec.run({ [rec.inputNames[0]]: alignedTensor(src, sw, sh, kps) });
  const emb = out[rec.outputNames[0]].data;
  let norm = 0;
  for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(emb, (v) => Math.round((v / norm) * 1e5) / 1e5);
}

// Giro da cabeca: deslocamento do nariz em relacao ao meio dos olhos, medido com o rosto "endireitado" pela
// linha dos olhos (inclinar a cabeca ou uma foto no proprio plano nao conta como virar o rosto). ratio =
// distancia entre os olhos / distancia olhos-boca: encolhe quando a cabeca vira de verdade (perspectiva).
function pose(kps) {
  const roll = Math.atan2(kps[1][1] - kps[0][1], kps[1][0] - kps[0][0]);
  const eyes = Math.hypot(kps[1][0] - kps[0][0], kps[1][1] - kps[0][1]) || 1;
  const mx = (kps[0][0] + kps[1][0]) / 2, my = (kps[0][1] + kps[1][1]) / 2;
  const yaw = ((kps[2][0] - mx) * Math.cos(roll) + (kps[2][1] - my) * Math.sin(roll)) / eyes;
  const ratio = eyes / (Math.hypot((kps[3][0] + kps[4][0]) / 2 - mx, (kps[3][1] + kps[4][1]) / 2 - my) || 1);
  return { yaw: +yaw.toFixed(3), roll: +roll.toFixed(3), ratio: +ratio.toFixed(3) };
}

async function source(input) {
  const img = await sharp(input).rotate().resize(SRC_SIDE, SRC_SIDE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { src: img.data, sw: img.info.width, sh: img.info.height, img };
}

// Arquivo ou Buffer de imagem -> [{ d: number[] (normalizado), yaw, roll, ratio, kps, box: {x,y,w,h} (fracoes), score }]
// opts.maxSide: tamanho da deteccao (selfie: menor e mais rapido); opts.embed = false: so acha os rostos (sem d).
export async function analyze(input, { maxSide = MAX_SIDE, embed: withCode = true } = {}) {
  const { det, rec } = await load();
  const { src, sw, sh, img } = await source(input);
  const small = sw > maxSide || sh > maxSide
    ? await sharp(src, { raw: { width: sw, height: sh, channels: 3 } }).resize(maxSide, maxSide, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
    : img;
  const w = small.info.width, h = small.info.height;
  const k = sw / w;
  const faces = await detect(det, small.data, w, h, MIN_SCORE, MIN_FACE);
  const result = [];
  for (const f of faces) {
    const inSrc = { x: f.x * k, y: f.y * k, w: f.w * k, h: f.h * k, kps: f.kps.map(([x, y]) => [x * k, y * k]) };
    const kps = f.w < REFINE_BELOW ? await refine(det, src, sw, sh, inSrc) : inSrc.kps;
    result.push({
      ...(withCode ? { d: await embed(rec, src, sw, sh, kps) } : {}),
      ...pose(kps),
      kps: kps.map(([x, y]) => [+(x / sw).toFixed(5), +(y / sh).toFixed(5)]),
      box: { x: +Math.max(0, f.x / w).toFixed(4), y: +Math.max(0, f.y / h).toFixed(4), w: +(f.w / w).toFixed(4), h: +(f.h / h).toFixed(4) },
      score: +f.score.toFixed(3),
    });
  }
  return result;
}

// Codigo de um rosto ja achado por analyze (kps em fracoes da imagem), sem detectar de novo.
export async function embedAt(input, kps) {
  const { rec } = await load();
  const { src, sw, sh } = await source(input);
  return embed(rec, src, sw, sh, kps.map(([x, y]) => [x * sw, y * sh]));
}
