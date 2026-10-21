const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents) => brl.format((Number(cents) || 0) / 100);
export const centsToInput = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function dateBR(iso, long = false) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (long) return `${d} de ${new Date(y, m - 1, d).toLocaleDateString('pt-BR', { month: 'long' })} de ${y}`;
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}
export const dateTimeBR = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
export const plural = (n, one, many) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
export const compact = (n) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
