import crypto from 'node:crypto';
import { config } from './config.js';
import { DIM, DEFAULT_THRESHOLD, encodeDescriptor, decodeDescriptor } from './faces.js';

// Selfie ao vivo ("prova de vida"): o acervo geral, a busca por ano, os eventos abertos e o cadastro do rosto
// so aceitam um rosto capturado pela camera agora, nao uma foto qualquer de alguem (ex.: alguem buscando provas
// contra a pessoa da foto). O servidor sorteia a ordem dos movimentos (frente, esquerda, direita), confere nos
// quadros recebidos que e sempre a mesma pessoa, sozinha e perto da camera, e que a cabeca girou para os dois
// lados (uma foto impressa ou na tela inclinada nao muda a posicao do nariz em relacao aos olhos). Deu certo:
// devolve um passe assinado, valido por 30 minutos, com os codigos do rosto.

export const LIVE_REQUIRED = config.isProd || process.env.FACE_LIVENESS !== 'off';
const CHALLENGE_TTL = 3 * 60_000;
const TOKEN_TTL = 30 * 60_000;
const FRAMES_PER_STEP = 3; // por movimento; o servidor usa o melhor quadro de cada um
const MIN_FACE = 0.12; // rosto ocupa pelo menos 12% da largura do quadro (perto da camera)
const FRONT_YAW = 0.12; // de frente: nariz quase no meio dos olhos
const TURN_YAW = 0.16; // virado: nariz bem deslocado
const SAME_PERSON = DEFAULT_THRESHOLD;
const MAX_ROLL = 0.5; // ~30 graus: cabeca (ou foto) muito inclinada nao vale
const TURN_SHRINK = 0.92; // virando de verdade, olhos/boca encolhe pelo menos 8% em relacao a frente

const sign = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url')}`;
};
const open = (token) => {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
};

// Desafio: frente primeiro, depois esquerda e direita em ordem sorteada.
const used = new Map(); // desafios ja usados (nao valem duas vezes)
export function newChallenge() {
  const steps = ['front', ...(Math.random() < 0.5 ? ['left', 'right'] : ['right', 'left'])];
  return { challenge: sign({ k: 'c', steps, n: crypto.randomBytes(8).toString('hex'), exp: Date.now() + CHALLENGE_TTL }), steps, frames_per_step: FRAMES_PER_STEP };
}

const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const mean = (list) => unit(list[0].map((_, i) => list.reduce((s, v) => s + v[i], 0) / list.length));

// analyses: para cada quadro (na ordem enviada), a lista de rostos que o motor achou ({ box, score, yaw, roll,
// ratio, kps }, sem o codigo). embedFrame(i, kps) gera o codigo do rosto do quadro i: so dos quadros que provam a
// selfie (os 2 mais de frente e o mais virado de cada lado), porque o codigo e a parte pesada.
// Devolve { ok, reason } ou { ok, token, descriptors, frontIndex, box }.
export async function verifyLive(challenge, analyses, embedFrame) {
  const c = open(challenge);
  if (!c || c.k !== 'c') return { ok: false, reason: 'O tempo da selfie acabou. Tente de novo.' };
  if (used.has(c.n)) return { ok: false, reason: 'Esta selfie já foi usada. Tire outra.' };
  if (analyses.length !== c.steps.length * FRAMES_PER_STEP) return { ok: false, reason: 'A selfie ficou incompleta. Tente de novo.' };
  const frames = [];
  for (const [i, faces] of analyses.entries()) {
    const big = [...faces].sort((a, b) => b.box.w - a.box.w);
    if (!big.length) return { ok: false, reason: 'Não encontramos seu rosto em alguma parte do vídeo. Fique de frente, com boa luz.' };
    if (big[0].box.w < MIN_FACE) return { ok: false, reason: 'Aproxime mais o rosto da câmera.' };
    if (big[1] && big[1].box.w > big[0].box.w * 0.6) return { ok: false, reason: 'Apareceu mais de uma pessoa. Faça a selfie sozinho(a).' };
    if (Math.abs(big[0].roll || 0) > MAX_ROLL) return { ok: false, reason: 'Mantenha a cabeça reta, sem inclinar para o lado.' };
    frames.push({ step: c.steps[Math.floor(i / FRAMES_PER_STEP)], i, ...big[0] });
  }
  // Frente: os quadros mais de frente (pelo menos 2). Lados: o quadro mais virado de cada movimento.
  const front = frames.filter((f) => f.step === 'front').sort((a, b) => Math.abs(a.yaw) - Math.abs(b.yaw)).slice(0, 2);
  if (front.some((f) => Math.abs(f.yaw) > FRONT_YAW)) return { ok: false, reason: 'No começo, olhe direto para a câmera.' };
  const turned = (step) => frames.filter((f) => f.step === step).sort((a, b) => Math.abs(b.yaw) - Math.abs(a.yaw))[0];
  const L = turned('left'), R = turned('right');
  // Girou para os dois lados: lados opostos e bem marcados (foto impressa ou na tela nao gira).
  if (Math.abs(L.yaw) < TURN_YAW || Math.abs(R.yaw) < TURN_YAW) return { ok: false, reason: 'Vire um pouco mais o rosto para cada lado quando pedirmos.' };
  if (Math.sign(L.yaw) === Math.sign(R.yaw)) return { ok: false, reason: 'Vire o rosto para um lado e depois para o outro, como pedirmos.' };
  // Perspectiva de cabeca de verdade: virando, a distancia entre os olhos encolhe em relacao a olhos-boca.
  const frontRatio = front.reduce((sum, f) => sum + (f.ratio || 0), 0) / front.length;
  if ([L, R].some((f) => (f.ratio || 0) > frontRatio * TURN_SHRINK)) {
    return { ok: false, reason: 'Não conseguimos confirmar que é uma selfie ao vivo. Vire o rosto devagar para cada lado, sem mexer o celular.' };
  }
  // Mesma pessoa nos quadros de frente e nos virados (ninguem troca o rosto no meio da selfie).
  const proof = [...front, L, R];
  const codes = await Promise.all(proof.map((f) => embedFrame(f.i, f.kps)));
  const center = mean(codes.slice(0, front.length));
  if (codes.some((d) => dist(d, center) > SAME_PERSON)) return { ok: false, reason: 'O rosto mudou durante a selfie. Faça de novo, sozinho(a) na câmera.' };
  if (used.has(c.n)) return { ok: false, reason: 'Esta selfie já foi usada. Tire outra.' };
  used.set(c.n, c.exp);
  for (const [n, exp] of used) if (exp < Date.now()) used.delete(n);
  // Codigos: media de frente (o principal) e um de cada lado (ajudam a achar fotos de perfil).
  const descriptors = [center, unit(codes[front.length]), unit(codes[front.length + 1])];
  const best = front.sort((a, b) => b.score - a.score)[0];
  // no passe, cada codigo vai em 1 byte por numero (como no banco): o passe fica pequeno
  const packed = descriptors.map((d) => encodeDescriptor(d).toString('base64'));
  return { ok: true, token: sign({ k: 't', d: packed, exp: Date.now() + TOKEN_TTL }), descriptors, frontIndex: best.i, box: best.box };
}

// Passe da selfie ao vivo -> codigos do rosto (ou null se invalido/vencido).
export function readLiveToken(token) {
  const p = open(token);
  if (!p || p.k !== 't' || !Array.isArray(p.d) || p.d.some((d) => typeof d !== 'string')) return null;
  const codes = p.d.map((d) => Buffer.from(d, 'base64'));
  if (codes.some((b) => b.length !== DIM)) return null; // passe de outro modelo
  return codes.map((b) => Array.from(decodeDescriptor(b)));
}
