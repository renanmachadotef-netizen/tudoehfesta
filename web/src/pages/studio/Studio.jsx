import { NavLink, Navigate, Route, Routes, Link } from 'react-router-dom';
import { LayoutDashboard, FolderOpen, Receipt, Wallet, Tag, User, Plus, Clock, HardDrive, Stamp, Archive } from 'lucide-react';
import { useSite, useTitle } from '../../lib/site.jsx';
import { Loading } from '../../components/Layout.jsx';
import Dashboard from './Dashboard.jsx';
import EventsList from './EventsList.jsx';
import EventEditor from './EventEditor.jsx';
import Sales from './Sales.jsx';
import Finance from './Finance.jsx';
import Coupons from './Coupons.jsx';
import Profile from './Profile.jsx';
import Drive from './Drive.jsx';
import Watermark from './Watermark.jsx';
import Acervo from './Acervo.jsx';

export default function Studio() {
  const { user, ready } = useSite();
  useTitle('Painel do fotógrafo');
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/entrar?voltar=/painel" replace />;
  if (user.role === 'customer') return <Navigate to="/seja-fotografo" replace />;
  const approved = user.role === 'admin' || user.photographer_status === 'approved';

  return (
    <div className="panel">
      <aside className="panel-side">
        <div className="side-title">Fotógrafo</div>
        {approved && (
          <>
            <NavLink to="/painel" end><LayoutDashboard size={18} /> Visão geral</NavLink>
            <NavLink to="/painel/acervo"><Archive size={18} /> Acervo por ano</NavLink>
            <NavLink to="/painel/eventos"><FolderOpen size={18} /> Eventos</NavLink>
            <NavLink to="/painel/vendas"><Receipt size={18} /> Vendas</NavLink>
            <NavLink to="/painel/financeiro"><Wallet size={18} /> Financeiro</NavLink>
            <NavLink to="/painel/cupons"><Tag size={18} /> Cupons</NavLink>
            <NavLink to="/painel/drive"><HardDrive size={18} /> Google Drive</NavLink>
            <NavLink to="/painel/marca-dagua"><Stamp size={18} /> Marca d’água</NavLink>
          </>
        )}
        <NavLink to="/painel/perfil"><User size={18} /> Perfil e Pix</NavLink>
        {approved && (
          <Link to="/painel/eventos/novo" className="btn btn-accent btn-sm" style={{ marginTop: 14, color: '#fff', justifyContent: 'center' }}>
            <Plus size={16} /> Novo evento
          </Link>
        )}
      </aside>
      <section className="panel-main">
        {!approved && (
          <div className="alert alert-warn row" style={{ gap: 10, marginBottom: 20 }}>
            <Clock size={18} /> Seu cadastro está em análise. Complete o perfil e a chave Pix enquanto isso: avisamos quando liberar.
          </div>
        )}
        <Routes>
          {approved ? (
            <>
              <Route index element={<Dashboard />} />
              <Route path="acervo" element={<Acervo />} />
              <Route path="eventos" element={<EventsList />} />
              <Route path="eventos/novo" element={<EventEditor />} />
              <Route path="eventos/:id" element={<EventEditor />} />
              <Route path="vendas" element={<Sales />} />
              <Route path="financeiro" element={<Finance />} />
              <Route path="cupons" element={<Coupons />} />
              <Route path="drive" element={<Drive />} />
              <Route path="marca-dagua" element={<Watermark />} />
            </>
          ) : (
            <Route index element={<Navigate to="/painel/perfil" replace />} />
          )}
          <Route path="perfil" element={<Profile />} />
          <Route path="*" element={<Navigate to="/painel" replace />} />
        </Routes>
      </section>
    </div>
  );
}

// Grafico de barras simples (30 dias) usado no painel do fotografo e no admin.
export function Bars({ series, valueKey = 'cents', format }) {
  const max = Math.max(1, ...series.map((d) => d[valueKey]));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="bars">
        {series.map((d) => (
          <div key={d.day} className={d[valueKey] ? '' : 'zero'} style={{ height: `${(d[valueKey] / max) * 100}%` }}
            title={`${d.day.slice(8, 10)}/${d.day.slice(5, 7)}: ${format ? format(d[valueKey]) : d[valueKey]}`} />
        ))}
      </div>
      <div className="row between tiny muted">
        <span>{series[0]?.day.slice(8, 10)}/{series[0]?.day.slice(5, 7)}</span>
        <span>hoje</span>
      </div>
    </div>
  );
}

export function PageHead({ title, children }) {
  return (
    <div className="row between" style={{ marginBottom: 22 }}>
      <h2>{title}</h2>
      <div className="row">{children}</div>
    </div>
  );
}
