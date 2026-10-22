import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Search, ShoppingBag, User, Images, ScanFace, LogOut, LayoutDashboard, ShieldCheck, Camera, Receipt, Sparkles, EyeOff } from 'lucide-react';
import { useSite } from '../lib/site.jsx';
import { useCart } from '../lib/cart.js';
import { api } from '../lib/api.js';

export function Logo({ light = false }) {
  const { site } = useSite();
  if (site?.logo) {
    return (
      <Link to="/" className="logo" aria-label="Tudo Eh Festa">
        <img src={site.logo} alt="Tudo Eh Festa" />
      </Link>
    );
  }
  return (
    <Link to="/" className="logo" aria-label="Tudo Eh Festa" style={light ? { color: '#fff' } : undefined}>
      <span>Tudo Eh <i>Festa</i></span>
      <small>DESDE {site?.since || 2003}</small>
    </Link>
  );
}

function UserMenu() {
  const { user, refresh } = useSite();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const nav = useNavigate();
  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  if (!user) {
    return (
      <Link to="/entrar" className="btn btn-sm btn-ghost">
        <User size={16} /> Entrar
      </Link>
    );
  }
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    nav('/');
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Minha conta" style={{ background: 'var(--surface)' }}>
        <b style={{ fontSize: 14 }}>{user.name?.[0]?.toUpperCase() || <User size={18} />}</b>
        {user.matches_new > 0 && <span className="cart-count">{user.matches_new}</span>}
      </button>
      {open && (
        <div className="menu-pop" onClick={() => setOpen(false)}>
          <div style={{ padding: '8px 12px 10px' }}>
            <b style={{ display: 'block' }}>{user.name}</b>
            <span className="tiny muted">{user.email}</span>
          </div>
          <Link to="/encontradas"><Sparkles size={17} /> Encontradas para você{user.matches_new > 0 && <span className="dot-new" style={{ marginLeft: 'auto' }}>{user.matches_new}</span>}</Link>
          <Link to="/minhas-fotos"><Images size={17} /> Fotos adquiridas</Link>
          <Link to="/meu-rosto"><EyeOff size={17} /> Meu rosto e privacidade</Link>
          <Link to="/meus-pedidos"><Receipt size={17} /> Meus pedidos</Link>
          {(user.role === 'photographer' || user.role === 'admin') && (
            <Link to="/painel"><LayoutDashboard size={17} /> Painel do fotógrafo</Link>
          )}
          {user.role === 'admin' && <Link to="/admin"><ShieldCheck size={17} /> Administração</Link>}
          <Link to="/conta"><User size={17} /> Minha conta</Link>
          <button onClick={logout}><LogOut size={17} /> Sair</button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { items } = useCart();
  return (
    <header className="header">
      <div className="container header-inner">
        <Logo />
        <nav className="nav">
          <NavLink to="/eventos">Eventos</NavLink>
          <NavLink to="/buscar">Buscar com selfie</NavLink>
          <NavLink to="/fotografos">Fotógrafos</NavLink>
          <NavLink to="/seja-fotografo" className="nav-extra">Venda suas fotos</NavLink>
        </nav>
        <div className="grow" />
        <Link to="/buscar" className="btn btn-sm btn-accent header-cta">
          <ScanFace size={16} /> Achar minhas fotos
        </Link>
        <Link to="/carrinho" className="icon-btn" aria-label="Carrinho">
          <ShoppingBag size={20} />
          {items.length > 0 && <span className="cart-count">{items.length}</span>}
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}

function MobileNav() {
  const { items } = useCart();
  return (
    <nav className="mobile-nav">
      <NavLink to="/" end><Home size={21} />Início</NavLink>
      <NavLink to="/eventos"><Search size={21} />Eventos</NavLink>
      <NavLink to="/buscar"><ScanFace size={21} />Selfie</NavLink>
      <NavLink to="/carrinho">
        <ShoppingBag size={21} />Carrinho
        {items.length > 0 && <span className="cart-count" style={{ right: 'calc(50% - 22px)' }}>{items.length}</span>}
      </NavLink>
      <NavLink to="/encontradas"><Images size={21} />Minhas</NavLink>
    </nav>
  );
}

export function Footer() {
  const { site, categories, years } = useSite();
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="stack" style={{ gap: 10 }}>
          <Logo />
          <p className="small muted" style={{ maxWidth: 320 }}>
            {site?.tagline || 'Eternizando gerações!'} Fotografando o Extremo Sul Catarinense desde {site?.since || 2003}.
          </p>
          <div className="row small">
            {site?.whatsapp && <a href={`https://wa.me/${site.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a>}
            {site?.instagram && <a href={`https://instagram.com/${site.instagram}`} target="_blank" rel="noreferrer">Instagram</a>}
          </div>
        </div>
        <div>
          <h4>Eventos</h4>
          {(categories || []).filter((c) => c.events > 0).slice(0, 6).map((c) => (
            <Link key={c.id} to={`/categoria/${c.slug}`}>{c.name}</Link>
          ))}
          <Link to="/eventos">Todos os eventos</Link>
        </div>
        <div>
          <h4>Por ano</h4>
          {(years || []).slice(0, 6).map((y) => (
            <Link key={y.year} to={`/ano/${y.year}`}>Fotos de {y.year}</Link>
          ))}
        </div>
        <div>
          <h4>Tudo Eh Festa</h4>
          <Link to="/seja-fotografo">Seja fotógrafo parceiro</Link>
          <Link to="/fotografos">Fotógrafos</Link>
          <Link to="/privacidade">Privacidade e biometria</Link>
          <Link to="/termos">Termos de uso</Link>
        </div>
      </div>
      <div className="container tiny muted" style={{ marginTop: 28 }}>
        © {new Date().getFullYear()} Tudo Eh Festa · Araranguá, SC
      </div>
    </footer>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  const panel = pathname.startsWith('/painel') || pathname.startsWith('/admin');
  return (
    <>
      <Header />
      <main><Outlet /></main>
      {!panel && <Footer />}
      <MobileNav />
    </>
  );
}

export function Loading() {
  return <div className="loading"><div className="spinner" /></div>;
}

export function Empty({ icon: Icon = Camera, title, children }) {
  return (
    <div className="empty">
      <Icon size={36} strokeWidth={1.5} />
      <b style={{ color: 'var(--ink)' }}>{title}</b>
      {children}
    </div>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert alert-bad">{error.message || String(error)}</div>;
}
