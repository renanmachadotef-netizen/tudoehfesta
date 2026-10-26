import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, ImagePlus, ScanFace, ShieldCheck, X, SwitchCamera, UserPlus, Trash2, Search } from 'lucide-react';
import { fileToCanvas, selfieDescriptor, selfieStore, liveSelfie, STEP_TEXT } from '../lib/faces.js';

// Selfie ao vivo pela camera (prova de vida: a pessoa vira o rosto quando pedimos) ou, so em eventos particulares
// (allowPhoto), uma foto enviada. O rosto vira codigo no servidor e as imagens sao descartadas.
// onSelfie({ token | descriptor, preview }) e chamado quando ha selfie pronta. Por padrao a selfie vale so para esta
// busca (troca facil para buscar um amigo); com "Lembrar esta selfie" ela fica na aba para outros anos e eventos.
const usable = (s, allowPhoto) => !!s && ((s.token && (s.exp || 0) > Date.now()) || (allowPhoto && s.descriptor));
export default function SelfieSearch({ onSelfie, title = 'Encontre suas fotos com uma selfie', subtitle, scopeNote, busy, consentText, actionLabel = 'Buscar minhas fotos', readyTitle = 'Sua selfie está pronta', allowRemember = true, allowPhoto = false }) {
  const stored = allowRemember && usable(selfieStore.get(), allowPhoto) ? selfieStore.get() : null;
  const [selfie, setSelfie] = useState(stored);
  const [remember, setRemember] = useState(!!stored);
  const [consent, setConsent] = useState(!!stored);
  const [step, setStep] = useState(null); // passo da selfie ao vivo em andamento
  const [mode, setMode] = useState('idle'); // idle | camera | working
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [facing, setFacing] = useState('user');
  const videoRef = useRef();
  const streamRef = useRef();
  const fileRef = useRef();

  useEffect(() => {
    if (!allowRemember) return undefined;
    const sync = () => {
      const s = selfieStore.get();
      const ok = usable(s, allowPhoto);
      setRemember(ok);
      if (ok) setSelfie(s);
    };
    window.addEventListener('tef-selfie', sync);
    return () => window.removeEventListener('tef-selfie', sync);
  }, []);

  useEffect(() => () => stopCamera(), []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function process(input) {
    setMode('working');
    setError('');
    try {
      setStatus('Procurando seu rosto…');
      const res = await selfieDescriptor(input);
      if (!res) {
        setError('Não encontramos um rosto na foto. Tente de frente, sem óculos escuros e com boa luz.');
        setMode('idle');
        return;
      }
      const s = { descriptor: res.descriptor, preview: res.preview };
      if (remember) selfieStore.set(s);
      setSelfie(s);
      setMode('idle');
      onSelfie?.(s);
    } catch (err) {
      console.error(err);
      setError(err.status === 429 ? 'Muitas tentativas seguidas. Espere um minuto e tente de novo.' : 'Não conseguimos analisar a selfie agora. Verifique a internet e tente de novo.');
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
      setError(allowPhoto ? 'Não foi possível abrir a câmera. Você pode enviar uma foto da galeria.' : 'Não foi possível abrir a câmera. A busca no acervo precisa da selfie ao vivo: libere a câmera para este site ou use o celular.');
    }
  }

  // Selfie ao vivo: segue os movimentos pedidos pelo servidor e captura os quadros sozinha.
  async function captureLive() {
    setError('');
    try {
      const s = await liveSelfie(videoRef.current, (st) => setStep(st));
      stopCamera();
      setStep(null);
      if (remember) selfieStore.set(s);
      setSelfie(s);
      setMode('idle');
      onSelfie?.(s);
    } catch (err) {
      setStep(null);
      setError(err.status === 429 ? 'Muitas tentativas seguidas. Espere um minuto e tente de novo.' : err.message || 'Não conseguimos confirmar a selfie. Tente de novo.');
    }
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

  // Nova selfie / esquecer: apaga a selfie da tela e da aba.
  const forget = () => {
    selfieStore.clear();
    setRemember(false);
    setSelfie(null);
  };
  const toggleRemember = (on) => {
    setRemember(on);
    if (on && selfie) selfieStore.set(selfie);
    else selfieStore.clear();
  };

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
          <h3 style={{ fontSize: 20 }}>{selfie ? readyTitle : title}</h3>
          <p className="small" style={{ color: 'rgba(255,255,255,.7)' }}>
            {!selfie
              ? subtitle || 'Tire uma selfie e mostramos as fotos em que você aparece. Leva poucos segundos.'
              : remember
                ? 'Selfie lembrada nesta aba para buscar em outros anos e eventos. Ao fechar a aba ela some.'
                : allowRemember
                  ? 'Esta selfie vale só para esta busca. Com amigos? Use “Nova selfie” para procurar cada um.'
                  : 'Sua selfie é usada só para esta busca e não é guardada.'}
          </p>
          {scopeNote && <span className="scope-note"><Search size={13} /> {scopeNote}</span>}
        </div>
      </div>

      {mode === 'camera' && (
        <div className="stack" style={{ alignItems: 'center' }}>
          <div className="live-wrap">
            <video ref={videoRef} className="selfie-video" playsInline muted style={facing === 'environment' ? { transform: 'none' } : undefined} />
            {step && <div className="live-step">{step === 'sending' ? 'Conferindo…' : STEP_TEXT[step]}</div>}
          </div>
          {!step && <p className="small" style={{ color: 'rgba(255,255,255,.75)', textAlign: 'center', maxWidth: 420 }}>Selfie ao vivo: vamos pedir para você olhar para a câmera e virar o rosto para os lados. Leva uns 6 segundos.</p>}
          <div className="row">
            <button className="btn btn-accent btn-lg" disabled={!!step} onClick={captureLive}><Camera size={19} /> {step ? 'Gravando…' : 'Começar'}</button>
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
                {consentText || 'Autorizo usar minha selfie ao vivo (alguns quadros da câmera) para encontrar minhas fotos. Ela é analisada no servidor do site só para gerar o código do rosto e é descartada na hora, sem ser guardada.'}{' '}
                <Link to="/privacidade" style={{ textDecoration: 'underline' }}>Saiba mais</Link>
              </span>
            </label>
          )}
          <div className="row">
            {selfie ? (
              <>
                <button className="btn btn-accent" disabled={working} onClick={() => onSelfie?.(selfie)}>
                  <ScanFace size={18} /> {working ? 'Aguarde…' : actionLabel}
                </button>
                <button className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.25)' }} disabled={working} onClick={forget}>
                  <UserPlus size={17} /> {allowRemember ? 'Nova selfie (outra pessoa)' : 'Trocar selfie'}
                </button>
                {remember && (
                  <button className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.25)' }} disabled={working} onClick={forget}>
                    <Trash2 size={16} /> Esquecer selfie
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="btn btn-accent" disabled={!consent || working} onClick={() => openCamera()}>
                  <Camera size={18} /> Selfie ao vivo
                </button>
                {allowPhoto && (
                  <button className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.25)' }} disabled={!consent || working} onClick={() => fileRef.current?.click()}>
                    <ImagePlus size={18} /> Enviar foto
                  </button>
                )}
              </>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />
          </div>
          {allowRemember && selfie && (
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => toggleRemember(e.target.checked)} />
              <span>Lembrar esta selfie enquanto a aba estiver aberta, para buscar em outros anos e eventos sem tirar outra.</span>
            </label>
          )}
        </>
      )}

      {mode === 'working' && <div className="row small" style={{ color: 'rgba(255,255,255,.8)' }}><div className="spinner" /> {status}</div>}
      {error && <div className="alert alert-bad">{error}</div>}
      <div className="row tiny" style={{ color: 'rgba(255,255,255,.5)', gap: 6 }}>
        <ShieldCheck size={14} /> {allowPhoto ? 'Evento particular: vale selfie ao vivo ou foto.' : 'Selfie ao vivo para proteger quem aparece nas fotos: ninguém busca você com uma foto sua.'} Nada é guardado: vira um código numérico e as imagens são descartadas (LGPD).
      </div>
    </div>
  );
}
