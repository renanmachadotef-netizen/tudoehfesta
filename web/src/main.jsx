import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import { SiteProvider } from './lib/site.jsx';
import Layout, { Loading } from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Events from './pages/Events.jsx';
import EventPage from './pages/Event.jsx';

// Paginas menos visitadas e paineis carregam sob demanda: a home fica leve.
const SearchPage = lazy(() => import('./pages/Search.jsx'));
const YearPage = lazy(() => import('./pages/Year.jsx'));
const Cart = lazy(() => import('./pages/Cart.jsx'));
const Order = lazy(() => import('./pages/Order.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const Auth = lazy(() => import('./pages/Auth.jsx'));
const BecomePhotographer = lazy(() => import('./pages/BecomePhotographer.jsx'));
const Photographers = lazy(() => import('./pages/Photographers.jsx'));
const Legal = lazy(() => import('./pages/Legal.jsx'));
const Studio = lazy(() => import('./pages/studio/Studio.jsx'));
const Admin = lazy(() => import('./pages/admin/Admin.jsx'));

function NotFound() {
  return (
    <div className="container section center stack" style={{ alignItems: 'center' }}>
      <h1>404</h1>
      <p className="muted">Essa página não existe (ou mudou de lugar).</p>
      <a className="btn" href="/">Voltar ao início</a>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SiteProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="eventos" element={<Events />} />
              <Route path="categoria/:category" element={<Events />} />
              <Route path="evento/:slug" element={<EventPage />} />
              <Route path="ano/:year" element={<YearPage />} />
              <Route path="buscar" element={<SearchPage />} />
              <Route path="carrinho" element={<Cart />} />
              <Route path="pedido/:code" element={<Order />} />
              <Route path="minhas-fotos" element={<Account tab="fotos" />} />
              <Route path="encontradas" element={<Account tab="encontradas" />} />
              <Route path="meu-rosto" element={<Account tab="rosto" />} />
              <Route path="meus-pedidos" element={<Account tab="pedidos" />} />
              <Route path="conta" element={<Account tab="conta" />} />
              <Route path="entrar" element={<Auth mode="login" />} />
              <Route path="cadastro" element={<Auth mode="register" />} />
              <Route path="seja-fotografo" element={<BecomePhotographer />} />
              <Route path="fotografos" element={<Photographers />} />
              <Route path="fotografo/:slug" element={<Photographers />} />
              <Route path="privacidade" element={<Legal page="privacidade" />} />
              <Route path="termos" element={<Legal page="termos" />} />
              <Route path="painel/*" element={<Studio />} />
              <Route path="admin/*" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </SiteProvider>
    </BrowserRouter>
  </StrictMode>,
);
