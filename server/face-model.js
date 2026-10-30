// Qual reconhecimento facial esta em uso (FACE_MODEL). Trocar de modelo refaz os rostos de todas as fotos
// (ver migrateFaceModel), porque os codigos de modelos diferentes nao se comparam.
//   - buffalo_l (padrao): InsightFace, detector SCRFD 10G + ArcFace ResNet-50, codigo de 512 numeros.
//     Licenca dos modelos: so pesquisa/nao comercial; uso comercial pede licenca do InsightFace.
//   - sface: OpenCV, detector YuNet (MIT) + SFace (Apache 2.0), codigo de 128 numeros.
export const FACE_MODEL = process.env.FACE_MODEL === 'sface' ? 'sface' : 'buffalo_l';
export const DIM = FACE_MODEL === 'sface' ? 128 : 512;
