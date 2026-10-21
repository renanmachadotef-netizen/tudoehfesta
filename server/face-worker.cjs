// Thread separada para o reconhecimento facial no servidor (TensorFlow.js com WebAssembly).
// Cada foto leva ~0,4-1 s de CPU; rodando aqui o site continua respondendo durante importacoes grandes.
const { parentPort } = require('node:worker_threads');
const path = require('node:path');
const tf = require('@tensorflow/tfjs');
require('@tensorflow/tfjs-backend-wasm');
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
const sharp = require('sharp');

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      await tf.setBackend('wasm');
      await tf.ready();
      const dir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(dir);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(dir);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(dir);
    })();
  }
  return ready;
}

async function detect(file) {
  await init();
  // Mesmo tamanho usado no navegador (maior lado 1400 px) para os vetores serem comparaveis.
  const { data, info } = await sharp(file).rotate().resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const tensor = tf.tensor3d(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), [info.height, info.width, 3], 'int32');
  try {
    const results = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45, maxResults: 60 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    return results
      .filter((r) => r.detection.box.width >= 24)
      .map((r) => {
        const b = r.detection.box;
        return {
          d: Array.from(r.descriptor),
          box: { x: +(b.x / info.width).toFixed(4), y: +(b.y / info.height).toFixed(4), w: +(b.width / info.width).toFixed(4), h: +(b.height / info.height).toFixed(4) },
        };
      });
  } finally {
    tensor.dispose();
  }
}

parentPort.on('message', async ({ id, file }) => {
  try {
    parentPort.postMessage({ id, faces: await detect(file) });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
