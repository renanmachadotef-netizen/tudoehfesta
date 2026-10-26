import { useSite, useTitle } from '../lib/site.jsx';

// Textos-base. Revisar com um advogado antes de considerar definitivos.
export default function Legal({ page }) {
  const { site } = useSite();
  useTitle(page === 'privacidade' ? 'Privacidade e biometria' : 'Termos de uso');
  const contato = site?.whatsapp ? `WhatsApp (${site.whatsapp.replace(/^55/, '')})` : 'nossos canais de atendimento';

  if (page === 'privacidade') {
    return (
      <div className="container section-sm">
        <div className="prose">
          <span className="eyebrow">LGPD</span>
          <h1 style={{ fontSize: 'clamp(28px,4vw,40px)' }}>Privacidade e reconhecimento facial</h1>
          <p>Este texto explica, em linguagem simples, como a Tudo Eh Festa trata seus dados, em especial os dados biométricos usados na busca por selfie.</p>
          <h2>Sua selfie</h2>
          <p>Quando você usa a busca por selfie, a imagem é enviada por conexão segura ao nosso servidor, que a transforma numa sequência de 128 números (um “vetor” do rosto) usando o mesmo reconhecimento das fotos do acervo. <b>A selfie fica só na memória durante essa análise e é descartada em seguida: não é gravada em disco nem compartilhada com terceiros</b>. Para proteger quem aparece nas fotos, a busca no acervo geral, por ano e nos eventos abertos exige a <b>selfie ao vivo</b>: a câmera capta alguns quadros enquanto a pessoa olha para a frente e vira o rosto para os lados, e o servidor confere que é uma pessoa de verdade naquele momento (ninguém consegue buscar outra pessoa usando uma foto dela). Eventos particulares, com senha ou acesso só por link, também aceitam uma foto enviada. O vetor é usado apenas no momento da busca, para comparar com os rostos das fotos publicadas, e não é guardado no servidor. O vetor fica salvo só na aba aberta do seu navegador, para você buscar em vários eventos sem tirar outra selfie, e some quando você fecha a aba ou toca em “Trocar selfie”.</p>
          <h2>Fotos dos eventos</h2>
          <p>Os fotógrafos publicam fotos de eventos públicos ou com autorização dos organizadores. Para permitir a busca, os rostos que aparecem nas fotos são convertidos em vetores numéricos no momento da publicação. Esses vetores são usados exclusivamente para a busca de fotos dentro da plataforma e não são compartilhados com terceiros.</p>
          <p>Se você aparece em uma foto e quer que ela seja removida ou que seu rosto não seja localizável, fale com a gente pelo {contato}. Atendemos o pedido e excluímos a foto e os vetores correspondentes.</p>
          <h2>Dados da conta e compras</h2>
          <p>Guardamos nome, e-mail, telefone (opcional) e o histórico de pedidos para entregar as fotos compradas e prestar suporte. Pagamentos são processados pelo Mercado Pago; não armazenamos dados de cartão.</p>
          <h2>Seus direitos</h2>
          <p>Você pode pedir acesso, correção ou exclusão dos seus dados a qualquer momento pelo {contato}.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="container section-sm">
      <div className="prose">
        <span className="eyebrow">Termos</span>
        <h1 style={{ fontSize: 'clamp(28px,4vw,40px)' }}>Termos de uso</h1>
        <h2>Compra de fotos</h2>
        <p>Ao comprar uma foto você recebe uma licença de uso pessoal: pode baixar, imprimir, guardar e publicar nas suas redes sociais. Não é permitido revender, usar comercialmente ou remover créditos do fotógrafo. Os direitos autorais continuam sendo do fotógrafo.</p>
        <p>As fotos ficam disponíveis para download na sua conta após a confirmação do pagamento. Problemas com o arquivo? Fale com a gente em até 7 dias.</p>
        <h2>Fotógrafos parceiros</h2>
        <p>O fotógrafo é responsável pelas fotos que publica e por ter autorização para fotografar o evento. A plataforma retém a comissão combinada sobre cada venda e repassa o restante via Pix, após o prazo de segurança para estornos. Cadastros podem ser suspensos em caso de conteúdo impróprio ou fraude.</p>
        <h2>Contato</h2>
        <p>Dúvidas: {contato}.</p>
      </div>
    </div>
  );
}
