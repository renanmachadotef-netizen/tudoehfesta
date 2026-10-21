// Reconhecimento facial 100% no navegador (face-api / TensorFlow.js com WebGL).
// - Fotografo: cada foto e analisada antes do upload e so os vetores (128 numeros por rosto) vao ao servidor.
// - Cliente: a selfie vira um vetor no aparelho; a imagem nunca e enviada nem guardada.
// A biblioteca (~1,3 MB) e os modelos (~12 MB, cache do navegador) so carregam quando alguem usa a busca.

let loading = null;

export function loadFaceApi(onStatus) {
  if (!loading) {
    loading = (async () => {
      onStatus?.('Carregando reconhecimento facial…');
      const faceapi = await import('@vladmandic/face-api');
      try {
        await faceapi.tf.setBackend('webgl');
      } catch {
        await faceapi.tf.setBackend('cpu');
      }
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
      return faceapi;
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

// Todos os rostos de uma foto de evento -> [{ d: number[128], box: {x,y,w,h} (fracoes) }]
export async function detectFaces(input, { minConfidence = 0.45 } = {}) {
  const faceapi = await loadFaceApi();
  const w = input.width || input.videoWidth;
  const h = input.height || input.videoHeight;
  const results = await faceapi
    .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence, maxResults: 60 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return results
    .filter((r) => r.detection.box.width >= 24)
    .map((r) => {
      const b = r.detection.box;
      return {
        d: Array.from(r.descriptor, (v) => Math.round(v * 1e6) / 1e6),
        box: { x: +(b.x / w).toFixed(4), y: +(b.y / h).toFixed(4), w: +(b.width / w).toFixed(4), h: +(b.height / h).toFixed(4) },
        score: r.detection.score,
      };
    });
}

// Selfie: pega o maior rosto. Devolve tambem um recorte pequeno so para mostrar na tela.
export async function selfieDescriptor(input) {
  const faces = await detectFaces(input, { minConfidence: 0.5 });
  if (!faces.length) return null;
  const best = faces.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  const w = input.width || input.videoWidth;
  const h = input.height || input.videoHeight;
  const crop = document.createElement('canvas');
  crop.width = crop.height = 128;
  const size = Math.min(w, h, Math.max(best.box.w * w, best.box.h * h) * 1.7);
  const cx = (best.box.x + best.box.w / 2) * w;
  const cy = (best.box.y + best.box.h / 2) * h;
  const sx = Math.min(Math.max(0, cx - size / 2), w - size);
  const sy = Math.min(Math.max(0, cy - size / 2), h - size);
  crop.getContext('2d').drawImage(input, sx, sy, size, size, 0, 0, 128, 128);
  return { descriptor: best.d, preview: crop.toDataURL('image/jpeg', 0.8), faces: faces.length };
}

// A selfie (so o vetor + miniatura) fica salva nesta aba para buscar em varios eventos sem tirar de novo.
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
