import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanFace, ShieldCheck, EyeOff, Trash2, Sparkles, X, Brain } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useSite } from '../lib/site.jsx';
import { dateBR, plural } from '../lib/format.js';
import { Loading, Empty } from '../components/Layout.jsx';
import { PhotoGrid } from '../components/Photos.jsx';
import SelfieSearch from '../components/SelfieSearch.jsx';
import BuyAll from '../components/BuyAll.jsx';
import { selfieStore } from '../lib/faces.js';

// "Encontradas para voce": fotos em que o sistema achou o cliente (com marca d'agua, prontas para comprar).
export function MatchedPhotos() {
  const { refresh, toast } = useSite();
  const { data, loading } = useApi('/my/matches');
  const face = useApi('/me/face');

  // Abriu a aba: as novas deixam de ser "novas".
  useEffect(() => {
    if (data?.photos?.some((p) => p.new)) api('/my/matches/seen', { method: 'POST' }).then(refresh).catch(() => {});
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || face.loading) return <Loading />;
  if (!face.data?.registered) {
    return (
      <Empty icon={ScanFace} title={face.data?.update_needed ? 'Tire uma selfie nova para continuar' : 'Cadastre seu rosto para receber suas fotos'}>
        <span>{face.data?.update_needed
          ? 'Atualizamos o reconhecimento facial do site para achar mais fotos suas, inclusive em fotos de grupo. O cadastro antigo não serve no sistema novo: tire uma selfie nova e voltamos a avisar quando você aparecer.'
          : 'Sempre que você aparecer numa foto nova, ela chega aqui automaticamente.'}</span>
        <Link to="/meu-rosto" className="btn btn-accent">Cadastrar meu rosto</Link>
      </Empty>
    );
  }
  const photos = data?.photos || [];
  if (!photos.length) {
    return (
      <Empty icon={Sparkles} title={face.data.scanning ? 'Procurando você nas fotos…' : 'Nenhuma foto nova por enquanto'}>
        <span>{face.data.scanning ? 'Estamos comparando seu rosto com todo o acervo. Volte em alguns minutos.' : 'Assim que você aparecer numa foto nova, ela chega aqui.'}</span>
      </Empty>
    );
  }
  const groups = [];
  for (const p of photos) {
    let g = groups.find((x) => x.slug === p.event_slug);
    if (!g) groups.push((g = { slug: p.event_slug, title: p.event_title, date: p.event_date, photos: [] }));
    g.photos.push(p);
  }
  const newCount = photos.filter((p) => p.new).length;
  return (
    <div className="stack" style={{ gap: 26 }}>
      <div className="row between card-flat" style={{ padding: 14 }}>
        <span className="small">
          {plural(photos.length, 'foto encontrada', 'fotos encontradas')} com você{newCount ? <> · <b>{newCount} novas</b></> : null}. As fotos vêm com marca d’água até a compra.
        </span>
      </div>
      <BuyAll photos={photos} />
      {groups.map((g) => (
        <section key={g.slug} className="stack" style={{ gap: 10 }}>
          <div><h3>{g.title}</h3><span className="small muted">{dateBR(g.date)} · {plural(g.photos.length, 'foto', 'fotos')}</span></div>
          <PhotoGrid photos={g.photos} rowHeight={170} eventInfo={{}} />
        </section>
      ))}
      <span className="tiny muted">Achou uma foto que não é você? Ela some daqui quando você comprar outras ou atualizar seu rosto em “Meu rosto e privacidade”.</span>
    </div>
  );
}

// Referencias que o rosto aprendeu com as fotos compradas e as marcadas como "Sou eu".
function LearnedRefs({ data, reload }) {
  const { toast } = useSite();
  const refs = data.refs || [];
  const bought = refs.filter((r) => r.source === 'compra').length;
  const marked = refs.length - bought;
  const drop = async (r) => {
    if (!confirm('Tirar esta foto das referências do seu rosto? Ela não volta a ser usada.')) return;
    await api(`/me/face/refs/${r.id}`, { method: 'DELETE' });
    toast('Foto tirada das referências.');
    reload();
  };
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <h3 className="row" style={{ gap: 8 }}><Brain size={18} /> Seu rosto aprende com as suas fotos</h3>
      <p className="small muted">
        Seu rosto em fotos de outras situações (de perfil, à noite, de óculos, alguns anos atrás) ajuda a achar mais fotos suas. Usamos as fotos que você
        <b> comprou</b> e as que você marcou como <b>“Sou eu”</b>, mas só o rosto que confere com a sua selfie: foto que você comprou de outra pessoa (filho, amigo) não entra.
      </p>
      {refs.length ? (
        <>
          <span className="small"><b>{refs.length + 1} referências:</b> sua selfie{bought ? ` + ${plural(bought, 'foto comprada', 'fotos compradas')}` : ''}{marked ? ` + ${plural(marked, 'foto marcada', 'fotos marcadas')}` : ''}.</span>
          <div className="refine-seeds">
            {refs.map((r) => (
              <button key={r.id} type="button" onClick={() => drop(r)} title={`${r.source === 'compra' ? 'Comprada' : 'Marcada como “Sou eu”'} · toque para tirar`} aria-label="Tirar esta foto das referências">
                <img src={r.thumb} alt="" /><X size={12} />
              </button>
            ))}
          </div>
          <span className="tiny muted">Usamos até 12 fotos, as mais diferentes entre si. Apagar o cadastro do rosto apaga todas.</span>
        </>
      ) : (
        <span className="small">{data.scanning ? 'Analisando as suas fotos…' : 'Por enquanto só a sua selfie. As fotos que você comprar (ou marcar como “Sou eu” numa busca) entram aqui.'}</span>
      )}
    </div>
  );
}

// Cadastro do rosto, monitoramento e "borrar minhas imagens".
export function FacePrivacy() {
  const { toast, refresh } = useSite();
  const { data, loading, reload } = useApi('/me/face');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);

  // Enquanto o sistema varre o acervo, atualiza o status.
  useEffect(() => {
    if (!data?.scanning) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [data?.scanning]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading />;

  const register = async (selfie) => {
    setBusy(true);
    try {
      await api('/me/face', { method: 'POST', body: { descriptors: [selfie.descriptor], consent: true } });
      toast('Rosto cadastrado! Procurando você nas fotos…');
      setChanging(false);
      reload();
      refresh();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const setBlur = async (blur) => {
    if (blur && !confirm('Borrar seu rosto em TODAS as fotos do site?\n\n• Seu rosto aparece borrado para todo mundo, inclusive em fotos compradas por outras pessoas.\n• Você deixa de aparecer na busca por selfie de qualquer outra pessoa.\n• Você continua vendo e comprando suas fotos aqui na sua conta.')) return;
    await api('/me/privacy', { method: 'PUT', body: { blur_me: blur } });
    toast(blur ? 'Pronto: suas imagens estão sendo borradas.' : 'Borrão desligado. As fotos voltam ao normal em instantes.');
    reload();
  };
  const remove = async () => {
    if (!confirm('Apagar o cadastro do seu rosto? O monitoramento para e, se estiver ligado, o borrão é desfeito.')) return;
    await api('/me/face', { method: 'DELETE' });
    selfieStore.clear();
    toast('Cadastro do rosto apagado.');
    reload();
    refresh();
  };

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 820 }}>
      {data.update_needed && !data.registered && (
        <div className="alert alert-warn">
          <b>Atualizamos o reconhecimento facial do site</b> para achar mais fotos suas, inclusive em fotos de grupo e de longe.
          O cadastro antigo do seu rosto não serve no sistema novo: tire uma selfie nova abaixo.{data.blur_me ? ' Enquanto isso, o borrão das suas imagens continua valendo nas fotos que já estão no site.' : ''}
        </div>
      )}
      {!data.registered || changing ? (
        <>
          <SelfieSearch
            onSelfie={register}
            busy={busy}
            title="Cadastre seu rosto"
            subtitle="Tire uma selfie: sempre que você aparecer numa foto nova, ela chega em “Encontradas para você”."
            readyTitle="Selfie pronta para cadastrar"
            actionLabel="Cadastrar meu rosto"
            consentText="Autorizo guardar um código numérico do meu rosto (não a foto) para encontrar minhas fotos e, se eu pedir, borrar minhas imagens. O código também aprende com o meu rosto nas fotos que eu comprar ou marcar como “Sou eu”. Posso apagar quando quiser."
            allowRemember={false}
          />
          {changing && <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setChanging(false)}>Cancelar</button>}
        </>
      ) : (
        <div className="card stack">
          <div className="row" style={{ gap: 12 }}>
            <div className="face-ring"><div><ScanFace size={28} color="#ffb21a" /></div></div>
            <div className="stack" style={{ gap: 2 }}>
              <b>Seu rosto está cadastrado</b>
              <span className="small muted">
                {data.scanning ? 'Procurando você em todas as fotos…' : 'O sistema monitora as fotos novas e avisa quando você aparecer.'}
                {data.consent_at && <> Autorizado em {dateBR(data.consent_at)}.</>}
              </span>
            </div>
          </div>
          <div className="row">
            <Link to="/encontradas" className="btn btn-sm btn-accent"><Sparkles size={14} /> Ver fotos encontradas</Link>
            <button className="btn btn-sm btn-soft" onClick={() => { selfieStore.clear(); setChanging(true); }}>Atualizar selfie</button>
            <button className="btn btn-sm btn-ghost" onClick={remove}><Trash2 size={14} /> Apagar cadastro do rosto</button>
          </div>
        </div>
      )}

      {data.registered && !changing && <LearnedRefs data={data} reload={reload} />}

      <div className="card stack">
        <h3 className="row" style={{ gap: 8 }}><EyeOff size={18} /> Borrar minhas imagens</h3>
        <p className="small muted">
          Uma camada extra de privacidade: seu rosto fica <b>borrado em todas as fotos do site</b> (vitrines e fotos compradas por outras pessoas)
          e você <b>deixa de aparecer na busca por selfie</b> de qualquer outra pessoa, mesmo que ela use uma foto sua. Você continua vendo e
          comprando as suas fotos aqui, sem borrão.
        </p>
        {!data.registered ? (
          <div className="alert">Cadastre seu rosto acima para o sistema saber quem borrar.</div>
        ) : (
          <div className="row between">
            <span className="small">
              {data.blur_me
                ? <><b style={{ color: 'var(--ok)' }}>Ligado.</b> {data.scanning ? 'Aplicando o borrão nas fotos…' : plural(data.blurred, 'rosto borrado', 'rostos borrados')}</>
                : <b>Desligado.</b>}
            </span>
            <button className={`btn btn-sm ${data.blur_me ? 'btn-ghost' : 'btn-accent'}`} onClick={() => setBlur(!data.blur_me)}>
              {data.blur_me ? 'Desligar borrão' : 'Borrar todas as minhas imagens'}
            </button>
          </div>
        )}
        <span className="tiny muted row" style={{ gap: 6 }}><ShieldCheck size={13} /> Guardamos só um código numérico do rosto, nunca a selfie. Você pode apagar a qualquer momento (LGPD).</span>
      </div>
    </div>
  );
}
