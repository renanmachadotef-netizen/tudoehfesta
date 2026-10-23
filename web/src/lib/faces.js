// Reconhecimento facial da selfie no navegador (Human: BlazeFace + FaceMesh + FaceRes, os mesmos modelos do servidor).
// A selfie vira um codigo de 1024 numeros no aparelho; a imagem nunca e enviada nem guardada.
// A biblioteca e os modelos (~9 MB, cache do navegador) so carregam quando alguem usa a busca.

let loading = null;

export function loadFaceEngine(onStatus) {
  if (!loading) {
    loading = (async () => {
      onStatus?.('Carregando reconhecimento facial…');
      const { Human } = await import('@vladmandic/human');
      const config = (backend) => ({
        backend, modelBasePath: '/models/', wasmPath: '/models/wasm/', debug: false, cacheSensitivity: 0,
        filter: { enabled: false }, gesture: { enabled: false }, body: { enabled: false }, hand: { enabled: false },
        object: { enabled: false }, segmentation: { enabled: false },
        face: {
          enabled: true,
          detector: { rotation: true, maxDetected: 10, minConfidence: 0.3, skipFrames: 0, skipTime: 0, return: false },
          mesh: { enabled: true }, attention: { enabled: false }, iris: { enabled: false }, emotion: { enabled: false },
          description: { enabled: true, skipFrames: 0, skipTime: 0 }, antispoof: { enabled: false }, liveness: { enabled: false },
        },
      });
      // WebGL (placa de video) e o mais rapido; sem ele, WebAssembly.
      for (const backend of ['webgl', 'wasm']) {
        try {
          const human = new Human(config(backend));
          await human.load();
          await human.warmup();
          return human;
        } catch { /* tenta o proximo */ }
      }
      throw new Error('Este navegador não consegue rodar o reconhecimento facial.');
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

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

// Selfie: pega o maior rosto. Devolve tambem um recorte pequeno so para mostrar na tela.
export async function selfieDescriptor(input) {
  const human = await loadFaceEngine();
  const res = await human.detect(input);
  const faces = res.face.filter((f) => f.embedding?.length);
  if (!faces.length) return null;
  const best = faces.sort((p, q) => q.box[2] * q.box[3] - p.box[2] * p.box[3])[0];
  const w = input.width || input.videoWidth;
  const h = input.height || input.videoHeight;
  const [bx, by, bw, bh] = best.box;
  const crop = document.createElement('canvas');
  crop.width = crop.height = 128;
  const size = Math.min(w, h, Math.max(bw, bh) * 1.4);
  const sx = Math.min(Math.max(0, bx + bw / 2 - size / 2), w - size);
  const sy = Math.min(Math.max(0, by + bh / 2 - size / 2), h - size);
  crop.getContext('2d').drawImage(input, sx, sy, size, size, 0, 0, 128, 128);
  return { descriptor: Array.from(best.embedding, (v) => Math.round(v * 1e4) / 1e4), preview: crop.toDataURL('image/jpeg', 0.8), faces: faces.length };
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
