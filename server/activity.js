// Atividade recente do servidor para o painel "Ao vivo" do admin. Fica so na memoria (some num reinicio):
// e um retrato do que esta acontecendo agora, nao um historico.
const LOG = [];
const MAX_LOG = 400;
const HITS = new Map(); // tipo -> [{ t, n }] da ultima hora
const HOUR = 60 * 60_000;

export const startedAt = Date.now();

// Sincronizacao do Drive em andamento (ou null).
export const progress = { sync: null };

export function activity(kind, text) {
  LOG.push({ t: Date.now(), kind, text });
  if (LOG.length > MAX_LOG) LOG.splice(0, LOG.length - MAX_LOG);
}

export function count(kind, n = 1) {
  if (!n) return;
  const list = HITS.get(kind) || [];
  const now = Date.now();
  list.push({ t: now, n });
  while (list.length && list[0].t < now - HOUR) list.shift();
  HITS.set(kind, list);
}

export function rate(kind, minutes) {
  const since = Date.now() - minutes * 60_000;
  return (HITS.get(kind) || []).reduce((s, h) => (h.t >= since ? s + h.n : s), 0);
}

export const recentActivity = (n = 150) => LOG.slice(-n).reverse();
