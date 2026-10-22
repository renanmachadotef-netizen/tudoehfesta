import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { api } from '../lib/api.js';
import { cart, useCart } from '../lib/cart.js';
import { useSite } from '../lib/site.jsx';
import { money, plural } from '../lib/format.js';

// "Comprar todas as minhas fotos": depois da selfie, o preco de todas juntas (ja com pacote e descontos de cada
// evento) e um clique para ir ao carrinho. photos: as fotos encontradas que a pessoa ainda nao comprou.
export default function BuyAll({ photos }) {
  const { items } = useCart();
  const { toast } = useSite();
  const nav = useNavigate();
  const [price, setPrice] = useState(null);
  const key = photos.map((p) => p.id).join(',');

  useEffect(() => {
    if (!photos.length) return undefined;
    let alive = true;
    api('/cart/price', { method: 'POST', body: { photoIds: photos.map((p) => p.id) } })
      .then((d) => alive && setPrice(d))
      .catch(() => alive && setPrice(null));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!photos.length) return null;
  const inCart = new Set(items.map((i) => i.id));
  const missing = photos.filter((p) => !inCart.has(p.id));
  const saving = price ? price.subtotal - price.total : 0;
  const addMissing = () => { if (missing.length) cart.add(missing); };

  return (
    <div className="buy-all">
      <div className="stack" style={{ gap: 2 }}>
        <span className="buy-all-title">
          Todas as suas {plural(photos.length, 'foto', 'fotos')}{price ? <> por <b>{money(price.total)}</b></> : null}
        </span>
        <span className="small muted">
          {saving > 0 ? <>Economia de <b>{money(saving)}</b> com os descontos e pacotes dos eventos. </> : null}
          Alta resolução, sem marca d’água, liberadas na hora do pagamento.
        </span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-accent" onClick={() => { addMissing(); nav('/carrinho'); }}>
          <ShoppingBag size={17} /> Comprar todas
        </button>
        {missing.length > 0 && (
          <button className="btn btn-ghost" onClick={() => { addMissing(); toast(`${missing.length} fotos no carrinho`); }}>
            Só adicionar ao carrinho
          </button>
        )}
      </div>
    </div>
  );
}
