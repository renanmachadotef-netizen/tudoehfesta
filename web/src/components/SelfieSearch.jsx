import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, ImagePlus, ScanFace, ShieldCheck, X, SwitchCamera } from 'lucide-react';
import { fileToCanvas, loadFaceApi, selfieDescriptor, selfieStore } from '../lib/faces.js';

// Captura a selfie (camera ou arquivo), gera o vetor do rosto no aparelho e entrega ao pai.
// onSelfie({ descriptor, preview }) e chamado quando ha selfie pronta (inclusive a ja salva nesta aba).
export default function SelfieSearch({ onSelfie, title = 'Encontre suas fotos com uma selfie', subtitle, busy }) {
  const [selfie, setSelfie] = useState(() => selfieStore.get());
  const [consent, setConsent] = useState(!!selfieStore.get());
  const [mode, setMode] = useState('idle'); // idle | camera | working
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [facing, setFacing] = useState('user');
  const videoRef = useRef();
  const streamRef = useRef();
  const fileRef = useRef();

  useEffect(() => {
    const sync = () => setSelfie(selfieStore.get());
    window.addEventListener('tef-selfie', sync);
    return () => window.removeEventListener('tef-selfie', sync);
  }, []);

  useEffect(() => () => stopCamera(), []);

  // Pre-carrega o modelo assim que a pessoa marca o consentimento.
  useEffect(() => {
    if (consent) loadFaceApi().catch(() => {});
  }, [consent]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function process(input) {
    setMode('working');
    setError('');
    try {
      await loadFaceApi(setStatus);
      setStatus('Procurando seu rosto…');
      const res = await selfieDescriptor(input);
      if (!res) {
        setError('Não encontramos um rosto na foto. Tente de frente, sem óculos escuros e com boa luz.');
        setMode('idle');
        return;
      }
      const s = { descriptor: res.descriptor, preview: res.preview };
      selfieStore.set(s);
      setSelfie(s);
      setMode('idle');
      onSelfie?.(s);
    } catch (err) {
      console.error(err);
      setError('Seu navegador não conseguiu rodar o reconhecimento facial. Tente pelo Chrome ou Safari atualizado.');
      setMode('idle');
    }
  }

  async function openCamera(nextFacing = facing) {
    setError('');
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing, width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      setMode('camera');
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 30);
    } catch {
      setError('Não foi possível abrir a câmera. Você pode enviar uma foto da galeria.');
    }
  }

  async function capture() {
    const v = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    stopCamera();
    await process(canvas);
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      await process(await fileToCanvas(f, 1280));
    } catch {
      setError('Não conseguimos abrir essa imagem. Envie uma foto JPG ou PNG.');
      setMode('idle');
    }
  }

  const working = mode === 'working' || busy;

  return (
    <div className="selfie-box">
      <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'nowrap' }}>
        {selfie ? (
          <img src={selfie.preview} alt="Sua selfie" className="selfie-thumb" />
        ) : (
          <div className="face-ring"><div><ScanFace size={30} color="#ffb21a" /></div></div>
        )}
        <div className="stack" style={{ gap: 4 }}>
          <h3 style={{ fontSize: 20 }}>{selfie ? 'Sua selfie está pronta' : title}</h3>
          <p className="small" style={{ color: 'rgba(255,255,255,.7)' }}>
            {selfie
              ? 'Usamos sua selfie só neste aparelho para buscar suas fotos. Pode trocar quando quiser.'
              : subtitle || 'Tire uma selfie e mostramos as fotos em que você aparece. Leva poucos segundos.'}
          </p>
        </div>
      </div>

      {mode === 'camera' && (
        <div className="stack" style={{ alignItems: 'center' }}>
          <video ref={videoRef} className="selfie-video" playsInline muted style={facing === 'environment' ? { transform: 'none' } : undefined} />
          <div className="row">
            <button className="btn btn-accent btn-lg" onClick={capture}><Camera size={19} /> Tirar selfie</button>
            <button className="icon-btn" style={{ color: '#fff' }} aria-label="Trocar câmera" onClick={() => {
              const nf = facing === 'user' ? 'environment' : 'user';
              setFacing(nf);
              openCamera(nf);
            }}><SwitchCamera /></button>
            <button className="icon-btn" style={{ color: '#fff' }} aria-label="Cancelar" onClick={() => { stopCamera(); setMode('idle'); }}><X /></button>
          </div>
        </div>
      )}

      {mode !== 'camera' && (
        <>
          {!selfie && (
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                Autorizo usar minha selfie para encontrar minhas fotos. Ela é analisada no meu aparelho, não é enviada nem
                guardada. <Link to="/privacidade" style={{ textDecoration: 'underline' }}>Saiba mais</Link>
              </span>
            </label>
          )}
          <div className="row">
            {selfie ? (
              <>
                <button className="btn btn-accent" disabled={working} onClick={() => onSelfie?.(selfie)}>
                  <ScanFace size={18} /> {working ? 'Buscando…' : 'Buscar minhas fotos'}
                </button>
                <button className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.25)' }} disabled={working} onClick={() => { selfieStore.clear(); setSelfie(null); }}>
                  Trocar selfie
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-accent" disabled={!consent || working} onClick={() => openCamera()}>
                  <Camera size={18} /> Tirar selfie
                </button>
                <button className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.25)' }} disabled={!consent || working} onClick={() => fileRef.current?.click()}>
                  <ImagePlus size={18} /> Enviar foto
                </button>
              </>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />
          </div>
        </>
      )}

      {mode === 'working' && <div className="row small" style={{ color: 'rgba(255,255,255,.8)' }}><div className="spinner" /> {status}</div>}
      {error && <div className="alert alert-bad">{error}</div>}
      <div className="row tiny" style={{ color: 'rgba(255,255,255,.5)', gap: 6 }}>
        <ShieldCheck size={14} /> Sua selfie não sai do seu aparelho (LGPD).
      </div>
    </div>
  );
}
