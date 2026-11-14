import type { apresentarConsultaPublica } from '../presenters';
import { ESTILOS } from './estilos';
import { SCRIPT } from './script';

export type ConsultaPublica = ReturnType<typeof apresentarConsultaPublica>;

export interface ConfigPagamento {
  modo: 'fake' | 'mercadopago';
  /** Chave publica do Mercado Pago (publica por natureza; vem do ambiente). */
  publicKey?: string;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' });

const esc = (texto: unknown): string =>
  String(texto).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

// JSON dentro de <script>: escapar "<" impede que um nome com "</script>" feche a tag.
const jsonSeguro = (valor: unknown): string => JSON.stringify(valor).replace(/</g, '\\u003c');

const LOGO = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>`;
const CADEADO = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

function documento(titulo: string, corpo: string, scripts = ''): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%232563eb%22/%3E%3C/svg%3E">
<title>${esc(titulo)}</title>
<style>${ESTILOS}</style>
</head>
<body>
<header class="topo">
  <div class="marca"><span class="logo">${LOGO}</span><div><strong>Oficina</strong><span>Centro automotivo</span></div></div>
  <span class="seguro">${CADEADO} Página segura</span>
</header>
<main class="pagina">
${corpo}
</main>
${scripts}
</body>
</html>`;
}

function item(i: ConsultaPublica['itens'][number]): string {
  const servico = i.tipo === 'SERVICO';
  const subtotal = i.quantidade * i.precoUnitario;
  return `<li class="item">
      <div class="descricao"><span class="tipo ${servico ? 'tipo-servico' : 'tipo-peca'}">${servico ? 'Serviço' : 'Peça'}</span><span>${esc(i.descricao)}</span></div>
      <span class="resumo-linha">${i.quantidade} × ${brl.format(i.precoUnitario)}</span>
      <span class="num qtd">${i.quantidade}</span>
      <span class="num unit">${brl.format(i.precoUnitario)}</span>
      <span class="num sub">${brl.format(subtotal)}</span>
    </li>`;
}

/** Pagina do link enviado ao cliente: resumo do orcamento, aprovacao e pagamento. */
export function renderizarCheckout(orcamento: ConsultaPublica, pagamento: ConfigPagamento): string {
  const corpo = `
  <section class="cartao resumo">
    <div class="resumo-topo">
      <div><p class="rotulo">Orçamento da ordem de serviço</p><h1>OS #${esc(orcamento.osNumero)}</h1></div>
      <span id="status" class="selo">${esc(orcamento.status)}</span>
    </div>
    <dl class="dados">
      <div><dt>Cliente</dt><dd>${esc(orcamento.cliente.nome)}</dd></div>
      <div><dt>E-mail</dt><dd>${esc(orcamento.cliente.email)}</dd></div>
      <div><dt>Emitido em</dt><dd>${data.format(orcamento.criadoEm)}</dd></div>
    </dl>
    <ul class="itens">
      <li class="item cabecalho"><span>Descrição</span><span class="num">Qtd</span><span class="num">Unitário</span><span class="num">Subtotal</span></li>
      ${orcamento.itens.map(item).join('')}
    </ul>
    <div class="total"><span>Total</span><strong>${brl.format(orcamento.valorTotal)}</strong></div>
  </section>
  <section class="cartao acao" id="acao" aria-live="polite">
    <noscript>Ative o JavaScript do navegador para aprovar e pagar o orçamento.</noscript>
  </section>
  <p class="rodape">${CADEADO} Pagamento processado pelo Mercado Pago. Os dados do cartão não passam pela oficina.</p>`;

  const sdk =
    pagamento.modo === 'mercadopago'
      ? '<script src="https://sdk.mercadopago.com/js/v2"></script>\n'
      : '';
  const scripts = `<script id="dados" type="application/json">${jsonSeguro({
    orcamento,
    pagamento: { modo: pagamento.modo, publicKey: pagamento.publicKey ?? null },
  })}</script>
${sdk}<script>${SCRIPT}</script>`;

  return documento(`Orçamento OS #${orcamento.osNumero} · Oficina`, corpo, scripts);
}

const ERROS: Record<number, [string, string]> = {
  403: [
    'Link inválido',
    'Este link de orçamento não é válido ou expirou. Use o link mais recente enviado por e-mail ou fale com a oficina.',
  ],
  404: [
    'Orçamento não encontrado',
    'Não encontramos este orçamento. Confira se o link foi copiado por inteiro ou fale com a oficina.',
  ],
};

/** Pagina de erro amigavel para quem abriu o link (nunca JSON). */
export function renderizarErro(status: number): string {
  const [titulo, mensagem] = ERROS[status] ?? [
    'Algo deu errado',
    'Não foi possível carregar o orçamento agora. Tente novamente em alguns instantes.',
  ];
  return documento(
    `${titulo} · Oficina`,
    `<section class="cartao"><div class="estado">
      <div class="icone icone-perigo"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg></div>
      <h2>${titulo}</h2><p class="texto">${mensagem}</p>
    </div></section>`,
  );
}
