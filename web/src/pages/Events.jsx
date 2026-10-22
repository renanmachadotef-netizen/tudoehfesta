import { Link, useParams } from 'react-router-dom';
import { ScanFace } from 'lucide-react';
import { useSite, useTitle } from '../lib/site.jsx';
import EventBrowser, { catLabel } from '../components/EventBrowser.jsx';

// Todos os eventos, ou uma categoria (/formaturas, /esportes, /festas, /categoria/:slug).
export default function Events({ category: fixed }) {
  const { category: param } = useParams();
  const category = fixed || param;
  const { categories = [] } = useSite();
  const cat = categories.find((c) => c.slug === category);
  const name = cat ? catLabel(cat) : category ? '' : 'Todos os eventos';
  useTitle(name || 'Eventos');

  return (
    <div className="container section-sm">
      <EventBrowser
        category={category}
        heading="h1"
        title={name}
        subtitle={cat ? `Fotos de ${name.toLowerCase()} do Extremo Sul Catarinense.` : 'Encontre o evento que você participou.'}
        actions={<Link to="/buscar" className="btn btn-accent btn-sm"><ScanFace size={16} /> Achar minhas fotos com selfie</Link>}
      />
    </div>
  );
}
