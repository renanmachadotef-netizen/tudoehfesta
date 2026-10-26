// Selfie: a foto vai para o nosso servidor so para gerar o codigo do rosto (mesmo reconhecimento das fotos do
// acervo) e e descartada na hora, sem ser gravada. Volta so o codigo (128 numeros) e onde esta o rosto.
import { api } from './api.js';

// Desenha a imagem (respeitando a rotacao EXIF) num canvas com o maior lado limitado.
export async function fileToCanvas(file, maxSide = 1400) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas;
}

// Selfie (canvas ou video) -> { descriptor, preview, faces } ou null se nao achou rosto.
export async function selfieDescriptor(input) {
  const w = input.width || input.videoWidth;
  const h = input.height || input.videoHeight;
  let canvas = input;
  if (!(input instanceof HTMLCanvasElement)) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(input, 0, 0, w, h);
  }
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
  const form = new FormData();
  form.append('file', blob, 'selfie.jpg');
  const res = await api('/faces/embed', { method: 'POST', form });
  if (!res.descriptor) return null;
  // miniatura do rosto so para mostrar na tela
  const { x, y, w: bw, h: bh } = res.box;
  const size = Math.min(w, h, Math.max(bw * w, bh * h) * 1.8);
  const sx = Math.min(Math.max(0, (x + bw / 2) * w - size / 2), w - size);
  const sy = Math.min(Math.max(0, (y + bh / 2) * h - size / 2), h - size);
  const crop = document.createElement('canvas');
  crop.width = crop.height = 128;
  crop.getContext('2d').drawImage(canvas, sx, sy, size, size, 0, 0, 128, 128);
  return { descriptor: res.descriptor, preview: crop.toDataURL('image/jpeg', 0.8), faces: res.faces };
}

// Selfie ao vivo: o servidor sorteia os movimentos (frente, esquerda, direita); a camera captura alguns quadros
// em cada um e o servidor confere que e uma pessoa de verdade, ao vivo. Volta um passe (valido por 30 min)
// usado nas buscas do acervo, da busca por ano e dos eventos abertos. onStep(step, progresso) atualiza a tela.
export const STEP_TEXT = { front: 'Olhe para a câmera', left: 'Vire o rosto devagar para a sua esquerda', right: 'Agora vire para a sua direita' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function frame(video) {
  const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c;
}
export async function liveSelfie(video, onStep) {
  const { challenge, steps, frames_per_step: per } = await api('/faces/live/start');
  const canvases = [];
  for (const [i, step] of steps.entries()) {
    onStep(step, i / steps.length);
    await wait(step === 'front' ? 1200 : 1600); // tempo de virar o rosto
    for (let k = 0; k < per; k++) {
      canvases.push(frame(video));
      await wait(280);
    }
  }
  onStep('sending', 1);
  const form = new FormData();
  form.append('challenge', challenge);
  for (const [i, c] of canvases.entries()) form.append('frames', await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.88)), `q${i}.jpg`);
  const res = await api('/faces/live', { method: 'POST', form });
  // miniatura do rosto (quadro de frente) so para mostrar na tela
  const c = canvases[res.frame] || canvases[0];
  const { x, y, w, h } = res.box;
  const size = Math.min(c.width, c.height, Math.max(w * c.width, h * c.height) * 1.8);
  const sx = Math.min(Math.max(0, (x + w / 2) * c.width - size / 2), c.width - size);
  const sy = Math.min(Math.max(0, (y + h / 2) * c.height - size / 2), c.height - size);
  const crop = document.createElement('canvas');
  crop.width = crop.height = 128;
  crop.getContext('2d').drawImage(c, sx, sy, size, size, 0, 0, 128, 128);
  return { token: res.token, preview: crop.toDataURL('image/jpeg', 0.8), exp: Date.now() + 28 * 60_000 };
}

// Selfie lembrada (so o vetor + miniatura), apenas quando a pessoa marca "Lembrar esta selfie":
// fica nesta aba para buscar em outros anos e eventos; some ao fechar a aba ou em "Esquecer selfie".
const KEY = 'tef_selfie';
export const selfieStore = {
  get() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
  },
  set(v) {
    try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sem armazenamento */ }
    window.dispatchEvent(new Event('tef-selfie'));
  },
  clear() {
    try { sessionStorage.removeItem(KEY); } catch { /* sem armazenamento */ }
    window.dispatchEvent(new Event('tef-selfie'));
  },
};
