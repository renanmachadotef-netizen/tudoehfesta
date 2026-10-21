import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const SiteCtx = createContext(null);

export function SiteProvider({ children }) {
  const [data, setData] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const timer = useRef();

  const refresh = useCallback(async () => {
    try {
      setData(await api('/site'));
    } catch {
      setData((d) => d || { site: {}, categories: [], years: [], totals: {}, user: null, payments: {} });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toast = useCallback((msg) => {
    clearTimeout(timer.current);
    setToastMsg(msg);
    timer.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  return (
    <SiteCtx.Provider value={{ ...(data || {}), ready: !!data, refresh, toast }}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </SiteCtx.Provider>
  );
}

export const useSite = () => useContext(SiteCtx);

// Carrega dados de uma rota da API com estados de carregando/erro.
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await api(path), error: null, loading: false });
    } catch (error) {
      setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Tudo Eh Festa` : 'Tudo Eh Festa · Encontre suas fotos com uma selfie';
  }, [title]);
}
