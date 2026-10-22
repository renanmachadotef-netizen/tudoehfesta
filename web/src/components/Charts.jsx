// Barras simples para relatorios: values = numeros, labels = rotulo de cada barra (mostrado no eixo a cada `every`).
export function MiniBars({ values, labels = [], format = (v) => v, height = 120, every = 1, color }) {
  const max = Math.max(1, ...values);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="bars" style={{ height }} role="img" aria-label={values.map((v, i) => `${labels[i] ?? i}: ${format(v)}`).join(', ')}>
        {values.map((v, i) => (
          <div key={i} className={v ? '' : 'zero'} style={{ height: `${(v / max) * 100}%`, ...(color && v ? { background: color } : {}) }} title={`${labels[i] ?? i}: ${format(v)}`} />
        ))}
      </div>
      <div className="mini-axis">
        {values.map((_, i) => <span key={i}>{i % every === 0 ? labels[i] ?? '' : ''}</span>)}
      </div>
    </div>
  );
}

// Barras horizontais com rotulo e valor (aparelhos, paginas).
export function HBars({ rows, format = (v) => v }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label} className="hbar">
          <span className="small">{r.label}</span>
          <div className="hbar-track"><i style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <b className="small">{format(r.value)}</b>
        </div>
      ))}
    </div>
  );
}
