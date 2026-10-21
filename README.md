# Tudo Eh Festa

Plataforma de venda de fotos de eventos com reconhecimento facial, feita para o Tudo Eh Festa (Araranguá, SC, desde 2003) e para fotógrafos parceiros da região. Substitui a loja na Fotto (`tudoehfesta.fotto.com.br`).

## O que tem

**Cliente**
- Eventos por categoria, por ano (`/ano/2026`) e busca por nome, cidade ou local.
- Busca por selfie em três escopos: um evento, um ano inteiro ou todo o acervo. A selfie vira um vetor **no próprio navegador** e não é enviada nem guardada (LGPD).
- Carrinho com desconto progressivo, pacote com teto por evento e cupons.
- Pagamento por Pix (QR na tela, aprovação automática) e cartão (Mercado Pago). Sem Mercado Pago configurado, o site funciona com Pix manual: o admin confirma o pedido.
- "Minhas fotos": downloads em alta, sem marca d'água, uma por uma ou num .zip.

**Fotógrafo** (`/painel`)
- Cadastro em `/seja-fotografo`, aprovação pelo admin.
- Upload em massa por arrastar e soltar. Rostos analisados no navegador do fotógrafo, sem custo de servidor. Fotos repetidas são ignoradas.
- Preço por foto, faixas de desconto, teto de pacote, cupons próprios.
- Painel com vendas do dia, da semana e do mês, gráfico de 30 dias, eventos que mais vendem, conversão por visita e planilha de vendas.
- Financeiro: saldo disponível e a liberar (prazo de estorno), saque via Pix.
- Kit de divulgação: link, QR Code e mensagem pronta para WhatsApp.

**Google Drive** (`/painel/drive`)
- O fotógrafo liga a pasta do ano. Cada subpasta vira um evento (`2026-09-12 Formatura CEJA - Criciúma` → nome, data e cidade). Fotos soltas vão para "Fotos de 2026".
- A cada `DRIVE_SYNC_MINUTES` o servidor importa as fotos novas, recusa repetidas, corrompidas, HEIC/RAW e de resolução baixa, indexa os rostos (TensorFlow WASM numa thread separada) e publica quando o evento fica pronto.
- Credencial: `GOOGLE_SERVICE_ACCOUNT_JSON` (pasta privada compartilhada com o e-mail da conta de serviço) ou `GOOGLE_API_KEY` (pasta pública por link).

**Marca d'água**: padrão do site (admin), do fotógrafo ou nenhuma, por evento. Texto ou logo PNG, transparência e posição (diagonal, centro, canto). Trocar refaz as vitrines em segundo plano a partir dos originais.

**Galeria oculta**: evento com "não exibir as fotos" só mostra a cada pessoa as fotos em que ela aparece (busca por selfie). Endereços das imagens têm código aleatório.

**Admin** (`/admin`)
- Faturamento, comissão, pendências (fotógrafos, saques, Pix manual).
- Aprovar ou bloquear fotógrafos e definir comissão por fotógrafo.
- Pedidos (marcar pago, cancelar, estornar), saques (marcar pago), eventos, categorias, usuários (senha provisória), configurações (comissão, prazo, saque mínimo, chave Pix, logo, WhatsApp).

## Arquitetura

```
Navegador (React + Vite)  ──>  Node/Express (API + site + imagens)  ──>  Postgres
   face-api (WebGL)                sharp: vitrine 1400px e miniatura 480px com marca d'água
                                   /data: originais (privados) e vitrines (públicas)
```

- `server/`: API (`routes/`), esquema SQL idempotente (`schema.sql`, roda a cada início), busca facial em memória (`faces.js`), preços (`pricing.js`), Mercado Pago (`payments.js`).
- `web/`: site React. Painéis e a biblioteca de reconhecimento facial carregam sob demanda, para manter a home leve.
- Busca facial por força bruta em memória: cerca de 100 mil rostos ocupam ~51 MB e respondem em ~20 ms. Se um dia passar de milhões, trocar por pgvector.

## Rodar localmente

```bash
npm install
npm run dev
```

Abre o site em http://localhost:5173 e a API na porta 3001. Sem `DATABASE_URL`, usa um Postgres embutido (PGlite) em `./data`. Para ter um admin local: `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run dev`.

## Deploy (Easypanel)

Projeto `tudoehfesta` com dois serviços:

1. **Postgres** `db` (postgres:17).
2. **App** `site`: GitHub `tudoehfesta`, branch `main`, build por `Dockerfile`.
   - **Volume** montado em `/data` (sem isso as fotos somem a cada deploy).
   - Variáveis: ver `.env.example` (`DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `MP_ACCESS_TOKEN`).
   - Domínio: `www.tudoehfesta.com` (e `tudoehfesta.com`) na porta 80.
3. **Mercado Pago**: em Suas integrações, crie a aplicação, copie o Access Token de produção para `MP_ACCESS_TOKEN` e configure o webhook (evento "Pagamentos") para `https://www.tudoehfesta.com/api/webhooks/mercadopago`. Mesmo sem webhook, a página do pedido confere o pagamento sozinha a cada 5 segundos.

## Armazenamento

Cada foto ocupa o original mais cerca de 300 KB (vitrine e miniatura). Com originais de 8 MB, 10 mil fotos dão por volta de 80 GB. O VPS tem ~70 GB livres: acompanhe o disco no Easypanel. Próximo passo quando encher: mover originais para um armazenamento de objetos (Cloudflare R2 ou Backblaze B2).
